const express = require("express");
var server = express();
const nodemailer = require("nodemailer");
require('dotenv').config();
const { clacDistanceBetween2Points_Lat_Lon, getTimeFormat, getDateFormat, getCurrentDate, deepCopy, shouldConsiderReport, isJavaScript, 
getPakarData, getMdaData, getMdaDataFromDB, getPakarDataFromDB, getParkingLotsDataFromDB, getTheaterDataFromDB, getFestigalDataFromDB} = require('./util.js');

const LRU_cache = require('./LRU_cache.js');
const citiesLocationsCache = new LRU_cache(100);

const { Pool } = require('pg');
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
})

const HOSTNAME = 'mazav.herokuapp.com';
const PORT = process.env.PORT;

const MS_CONSIDER_REPORT = 60 * (60 * 1000);
const MAX_DISTANCE_TO_PLACE = 15;
const NUMBER_OF_DAYS_TO_RETURN = 4;
const NUMBER_OF_PLACES_TO_RETURN = 10;
const MAX_DISTANCE_TO_UPDATE_LOAD = 2;
const VERY_CLOSE_TO_PLACE_DISTANCE = 200;
const DAYS_TO_GET_DATA = 1;

var mdaData = [];
var pakarData = [];
var parkingLotsData = [];
var theaterData = [];
var festigalData = [];

var version = 116;

var IPsToTrafficCache = new LRU_cache(100);

server.use(express.json());

function defenseAgainstDDOS(req, res, next){
    let ipAddress = req.socket.remoteAddress;

    //if has not encountered this ip address already 
    if(!IPsToTrafficCache.has(ipAddress)){
        IPsToTrafficCache.put(ipAddress, {time: getTimeFormat(getCurrentDate()), requestsCount: 1});
        next();
        return;
    }
    
    let ipInfo = IPsToTrafficCache.get(ipAddress);
    let lastRequestTime = new Date(ipInfo.time);

    let currentDate = getCurrentDate();

    const MS_TO_RESET_IP_INFO = 15 * (60 * 1000);


    //if enough time has passed since last call then reset the info about this ip
    if(currentDate.getTime() - lastRequestTime.getTime() >= MS_TO_RESET_IP_INFO){
        IPsToTrafficCache.put(ipAddress, {time: getTimeFormat(currentDate), requestsCount: 1});
        next();
        return;
    }
    
    let requestsCount = ipInfo.requestsCount;

    const REQUEST_COUNT_LIMIT = 40;

    //it means that user can request at most REQUEST_COUNT_LIMIT requests in MS_TO_RESET_IP_INFO
    //at most 40 requests in 15 minutes
    if(requestsCount > REQUEST_COUNT_LIMIT){
        console.log("DDOS attack! from: " + ipAddress);
        return;
    }

    IPsToTrafficCache.put(ipAddress, {time: getTimeFormat(lastRequestTime), requestsCount: requestsCount + 1});
    next();
}

server.use(defenseAgainstDDOS);

//start listen to requests
server.listen(PORT, async () => {
    console.log(`Server running at https://${HOSTNAME}:${PORT}/`);

    //get current version
    version = await new Promise((resolve, reject) => {
        pool.query(`SELECT version FROM config LIMIT 1;`, (err, res) => {
            if (err) return reject(err);
            resolve(res.rows[0].version);
        });
    })
    console.log("after get version: " + version);

    //setting a timeout to update the data in DB at 06:00
    //(I suspect that I can't send requests to mda server at 03:14 for example because this is in night)
    //if the server was deployed again in 2022-05-13 03:14 for example it will call for update
    let currentDate = getCurrentDate();
    let currentMinutes = currentDate.getMinutes() + currentDate.getHours() * 60;

    // //check if the hour 06:00 has passed 
    // if(currentMinutes > 360){
    //     let nextDay = getCurrentDate();
    //     nextDay.setDate(nextDay.getDate() + 1);
    //     nextDay.setHours(6);
    //     nextDay.setMinutes(0);

    //     setTimeout(updateAndGetDataFromDB, nextDay.getTime() - getCurrentDate().getTime());
    // }
    // else{
    //     let currentDayAt6AM = getCurrentDate();
    //     currentDayAt6AM.setHours(6);
    //     currentDayAt6AM.setMinutes(0);
    //     //if updateAndGetDataFromDB will be called in less than 5 minutes then change the time to be after 10 minutes
    //     //because this can collide with the getting of data from DB and I don't want it because I have limited number of connections to my DB
    //     if((currentDayAt6AM.getTime() - currentDate.getTime()) / (60 * 1000) < 5){
    //         currentDayAt6AM.setMinutes(10);
    //     }
    //     setTimeout(updateAndGetDataFromDB, currentDayAt6AM.getTime() - currentDate.getTime());
    // }

    mdaData = await getMdaDataFromDB();
    pakarData = await getPakarDataFromDB();
    parkingLotsData = await getParkingLotsDataFromDB();
    theaterData = await getTheaterDataFromDB();
    festigalData = await getFestigalDataFromDB();
    console.log("after getDataFromDB");

    // await writeLoadAccordingToDefaultLoad();
});

async function updateAndGetDataFromDB(){
    //get last update data time
    let lastDataUpdateTime = await new Promise((resolve, reject) => {
        pool.query(`SELECT update_data_time FROM config LIMIT 1;`, (err, res) => {
            if (err) return reject(err);
            resolve(res.rows[0].update_data_time)
        });
    })
    console.log("after get lastDataUpdateTime: " + lastDataUpdateTime);

    //check if the data should be updated (the data should be updated if a day has passed since the last update)
    if(lastDataUpdateTime == "" || 
    parseInt(Math.floor(getCurrentDate().getTime() / (24 * 60 * 60 * 1000))) - parseInt(Math.floor(new Date(lastDataUpdateTime).getTime() / (24 * 60 * 60 * 1000))) >= DAYS_TO_GET_DATA){
        await getPakarData();
        console.log("after getPakarData");

        await getMdaData();
        console.log("after getMdaData");

        //update the lastDataUpdateTime
        pool.query(`UPDATE config SET update_data_time = '${getTimeFormat(getCurrentDate())}';`, (err, res) => {
            if (err) {console.log(err); return;}
        });
    }

    mdaData = await getMdaDataFromDB();
    pakarData = await getPakarDataFromDB();
    parkingLotsData = await getParkingLotsDataFromDB();
    theaterData = await getTheaterDataFromDB();
    festigalData = await getFestigalDataFromDB();
    console.log("after getDataFromDB");
}

//Backwards compatibility
//return the subjects and types to the app from subjects_and_types file
server.get("/getSubjectsAndTypes", async (req, res) => {
    console.log("in getSubjectsAndTypes");

    let subjects_and_types_object = {
        "subjects": ["מתחמי בדיקת קורונה", "אירועים", "חניונים מרכזיים"],
        "types": [["בדיקה מהירה", "בדיקת pcr"], ["תיאטרון", "פסטיגל"], ["כללי"]]
    };

    res.send(subjects_and_types_object);
});

// log message if share button has been clicked
server.get("/logShare", async (req, res) => {
    console.log();
    console.log("in logShare");

    res.send({ messgae: "success" });
});

//Backwards compatibility
//return the subjects and types to the app from subjects_and_types file and check if need to update
server.post("/getSubjectsAndTypes", async (req, res) => {
    console.log();
    console.log("in getSubjectsAndTypes");

    let versionName = req.body.versionName;
    console.log("versionName: " + versionName);

    let message = "";
    let delay = 0;

    let splitedVersionName = versionName.split(".");
    let versionValue = splitedVersionName[2] * 1 + splitedVersionName[1] * 10 + splitedVersionName[0] * 100;


    if (versionValue < version) {
        console.log("need to update!")
        message = "קיימת גרסה חדשה יותר.\nהאם לעדכן?";
        delay = 10000;
    }

    let data;

    if (versionValue >= 114) {
        data = {
            "subjects": [1, 2, 3],
            "types": [[2, 1], [1, 2], [1]]
        }
    }
    else {
        data = {
            "subjects": ["מתחמי בדיקת קורונה", "אירועים", "חניונים מרכזיים"],
            "types": [["בדיקה מהירה", "בדיקת pcr"], ["תיאטרון", "פסטיגל"], ["כללי"]]
        }
    }

    //20 precents of the time the message would be shown, and 80 precents it won't
    if (message != "" && Math.random() > 0.2) {
        message = "";
        delay = 0;
    }

    if (message != "") console.log("new version message was sent");

    res.send({ data, message, delay });
});

//return the subjects and types to the app from subjects_and_types file and check if need to update
server.get("/getSubjectsAndTypes/versionName=:versionName", async (req, res) => {
    console.log();
    console.log("in getSubjectsAndTypes GET");

    let versionName = req.params.versionName;
    console.log("versionName: " + versionName);

    let message = "";
    let delay = 0;

    let splitedVersionName = versionName.split(".");
    let versionValue = splitedVersionName[2] * 1 + splitedVersionName[1] * 10 + splitedVersionName[0] * 100;


    if (versionValue < version) {
        console.log("need to update!")
        message = "קיימת גרסה חדשה יותר.\nהאם לעדכן?";
        delay = 10000;
    }

    let data = {
        "subjects": [1, 2, 3],
        "types": [[2, 1], [1, 2], [1]]
    }

    //20 precents of the time the message would be shown, and 80 precents it won't
    if (message != "" && Math.random() > 0.2) {
        message = "";
        delay = 0;
    }

    if (message != "") console.log("new version message was sent");

    res.send({ data, message, delay });
});

//Backwards compatibility
//return the app the list of places according to the lat-lon and type given
server.post("/getData", async (req, res) => {
    console.log();
    console.log("in getData");

    //get req params
    let locationString = req.body[0], type = req.body[1], category = req.body[2], cityIndex = req.body[3];

    //Backwards compatibility and validation
    if (Number.isInteger(type) == false) {
        if (type == "בדיקה מהירה") {
            type = 2;
        }
        else if (type == "בדיקת pcr") {
            type = 1;
        }
        else if (type == "כללי") {
            type = 1;
        }
        else if (type == "תיאטרון") {
            type = 1;
        }
        else if (type == "פסטיגל") {
            type = 2;
        }
        else {
            //empty array of places
            res.send([]);
            return;
        }
    }

    //Backwards compatibility and validation
    if (Number.isInteger(category) == false) {
        if (category == "מתחמי בדיקת קורונה") {
            category = 1;
        }
        else if (category == "חניונים מרכזיים") {
            category = 3;
        }
        else if (category == "אירועים") {
            category = 2;
        }
        else {
            //empty array of places
            res.send([]);
            return;
        }
    }

    let result = await getPlaces(locationString, type, category, cityIndex);

    res.send(result);
});

//return the app the list of places according to the lat-lon and type given
server.get("/getData/location=:location&type=:type&category=:category&cityIndex=:cityIndex", async (req, res) => {
    console.log();
    console.log("in getData GET");

    //get req params
    let locationString = req.params.location, type = parseInt(req.params.type), category = parseInt(req.params.category),
    cityIndex = parseInt(req.params.cityIndex);

    let result = await getPlaces(locationString, type, category, cityIndex);

    res.send(result);
});

//return all the places with the given type, category and location or cityIndex
async function getPlaces(locationString, type, category, cityIndex){
    //bad info check
    if (typeof locationString !== 'string') return [];
    if (isNaN(type)) return [];
    if (isNaN(category)) return [];
    if (cityIndex != undefined && isNaN(cityIndex)) cityIndex = undefined;

    let categoryAndType = {
        category: category,
        type: type
    }

    let allPlaces = undefined;

    if (category === 1) {
        console.log("in TestPlaces");
        categoryAndType.category = 'מתחמי בדיקת קורונה';
        if (type === 1){
            categoryAndType.type = 'פיקוד העורף PCR';
            allPlaces = pakarData;
        }
        else if (type === 2){
            categoryAndType.type = 'מד"א (מהירה)';
            allPlaces = mdaData;
        }
        else {
            //empty array of places
            return [];
        }
    }
    else if (category === 2) {
        console.log("in EventPlaces");
        categoryAndType.category = 'אירועים';
        if (type === 1){
            categoryAndType.type = 'תיאטרון';
            allPlaces = theaterData;
        }
        else if (type === 2){
            categoryAndType.type = 'פסטיגל';
            allPlaces = festigalData;
        }
        else {
            //empty array of places
            return [];
        }
    }
    else if (category === 3) {
        console.log("in ParkingPlaces");
        categoryAndType.category = 'חניונים מרכזיים';
        if (type === 1){
            categoryAndType.type = 'כללי';
            allPlaces = parkingLotsData;
        }
        else {
            //empty array of places
            return [];
        }
    }
    else {
        //empty array of places
        return [];
    }

    console.log("type: " + categoryAndType.type);
    console.log("category: " + categoryAndType.category);

    let userLocation = undefined;

    //if the location given is the current location or city
    if (locationString.includes("lat-lon")) {
        let lat_lon = locationString.split(":")[1].split(" ");
        userLocation = { lat: parseFloat(lat_lon[0]), lon: parseFloat(lat_lon[1]), currentLocation: true };
        console.log(`lat: ${userLocation.lat} lon: ${userLocation.lon}`);
    }
    else {
        let cityLocation = undefined;
        //cityIndex is 0-based index and city_id is 1-based index
        //this '$1' is placeholder which inforce the cityIndex param to be integer
        if(cityIndex != undefined) cityLocation = citiesLocationsCache.get(cityIndex + 1);

        if(cityLocation == -1 || cityLocation == undefined){ //doesn't have this city location in cache then add it to cache
            //getting the city
            let queryToGetCity = `SELECT city_id, lat, lon, name FROM cities WHERE city_id = $1 LIMIT 1;`;
            if(cityIndex == undefined) queryToGetCity = `SELECT city_id, lat, lon, name FROM cities WHERE name = $1 LIMIT 1;`;

            let city = await new Promise((resolve, reject) => {
                pool.query(queryToGetCity, [cityIndex == undefined ? locationString : (cityIndex + 1)], (err, resQuery) => {
                    if (err) {return reject(err);}

                    if(resQuery.rows.length > 0) return resolve(resQuery.rows[0]);
                    return resolve(undefined);
                });
            });

            if(city == undefined) return [];

            cityLocation = {lat: city.lat, lon: city.lon};
            citiesLocationsCache.put(city.city_id, cityLocation);
        }
        else console.log("cities cache has been used!");

        userLocation = cityLocation;
        userLocation.currentLocation = false;
        console.log(`city - lat: ${userLocation.lat} lon: ${userLocation.lon}`);
    }

    let placesToReturn = getClosestPlaces(allPlaces, userLocation);

    //doing this calculation once for all the places that would be returned
    //so I can use it many times (for each place)
    let currentDate = getCurrentDate();
    let currentDayOfWeek = currentDate.getDay();

    let nextNUMBER_OF_DAYS_TO_RETURNDatesFormat = [];
    for (let i = 0; i < NUMBER_OF_DAYS_TO_RETURN; i++) {
        nextNUMBER_OF_DAYS_TO_RETURNDatesFormat[i] = getDateFormat(currentDate);
        currentDate.setDate(currentDate.getDate() + 1);
    }

    for (let i in placesToReturn) {
        let place = placesToReturn[i];

        //update the loadInfo in the general location
        addLoadInfoToPlace(place, isOpen(place.dates[currentDayOfWeek]));

        //copy the place after updating the loadInfo
        placesToReturn[i] = deepCopy(place);

        placesToReturn[i].dates = getFormatedOpenHours(placesToReturn[i], currentDayOfWeek, nextNUMBER_OF_DAYS_TO_RETURNDatesFormat);
    }

    //remove the unnecessary properties
    placesToReturn.forEach((place) => {
        delete place.specialDates;
        delete place.hasOpenHoursToday;
        delete place.hasOpenHoursTimeAtAll;
        delete place.loadReports;
        delete place.isAlwaysOpen;
        delete place.reportedTime;

        //get only the hours and minutes to the user of lastReportedTime
        place.lastReportedTime = place.lastReportedTime.slice(11, 16);

        //Backwards compatibility (don't need this line from version 1.1.7)
        place.type = type;
    });

    //sort place by if they are currently open
    placesToReturn.sort((a, b) => {
        if (a.isOpen == b.isOpen) return 0;
        if (a.isOpen && !b.isOpen) return -1;
        if (!a.isOpen && b.isOpen) return 1;

        return 0;
    });

    console.log("number of places returned: " + placesToReturn.length);
    return placesToReturn;
}

//Backwards compatibility
//update the load in place according to the loadReport and place given
server.post("/reportLoad", async (req, res) => {
    console.log("in reportLoad");

    let placeIndex = req.body.placeIndex, loadReported = req.body.loadReported, category = req.body.categories,
        userLat = req.body.lat, userLon = req.body.lon, placeLat = req.body.placeLat, placeLon = req.body.placeLon;

    //Backwards compatibility
    if (Number.isInteger(category) == false) {
        if (category == "מתחמי בדיקת קורונה") category = 1;
        else if (category == "חניונים מרכזיים") category = 3; 
        else if (category == "אירועים") category = 2;
    }

    //bad info check
    if (isNaN(placeIndex)) return res.send(undefined);
    if (isNaN(loadReported) || (loadReported != 0 && loadReported != 1 && loadReported != 2)) return res.send(undefined);
    if (isNaN(category)) return res.send(undefined);
    if (isNaN(userLat)) return res.send(undefined);
    if (isNaN(userLon)) return res.send(undefined);
    if (isNaN(placeLat)) return res.send(undefined);
    if (isNaN(placeLon)) return res.send(undefined);

    console.log(`placeIndex: ${placeIndex} loadReported: ${loadReported} category: ${category}`);

    try {
        if (userLat != undefined) {
            console.log(`userLat: ${userLat} userLon: ${userLon} placeLat: ${placeLat} placeLon: ${placeLon}`);

            //check if user is near place (less than or equal to 2 km from place)
            if (clacDistanceBetween2Points_Lat_Lon(userLat, userLon, placeLat, placeLon) / 1000 > MAX_DISTANCE_TO_UPDATE_LOAD) {
                //user is not near place (less than or equal to 2 km from place)
                res.send({ message: "error", reason: "not near place", status: 404 });
                return;
            }
        }

        let placeReported = undefined;

        //search in all data for the place's index
        for (let i = 0; i < 5; i++) {
            let places = undefined;
            switch(i){
                case 0: places = mdaData; break;
                case 1: places = pakarData; break;
                case 2: places = parkingLotsData; break;
                case 3: places = theaterData; break;
                case 4: places = festigalData; break;
            }

            let placeFound = false;

            for(let place of places){
                if(place.index == placeIndex){
                    placeReported = place;
                    placeFound = true;
                    break;
                }
            }

            if(placeFound) break;
        }

        //add report load
        addReportLoad(placeReported, loadReported);

        return res.send({ message: "success", status: 200 });
    }
    catch (err) {
        return res.send({ message: "error: " + err, status: 404 });
    }
});


//send error report to email
server.post("/reportError", async (req, res) => {
    console.log("in reportError");
    let user_email = req.body.email, error_desc = req.body.desc, place = req.body.place, category = req.body.categories, versionName = req.body.versionName;

    //Backwards compatibility
    if (Number.isInteger(category) == false) {
        if (category == "מתחמי בדיקת קורונה") category = 1;
        else if (category == "חניונים מרכזיים") category = 3;
        else if (category == "אירועים") category = 2;
    }

    //bad info check
    if (isNaN(category)) return res.send(undefined);
    if(typeof user_email !== "string" || isJavaScript(user_email)) return res.send(undefined);
    if(typeof error_desc !== "string" || isJavaScript(error_desc)) return res.send(undefined);
    if(typeof error_desc === "string" && isJavaScript(place)) return res.send(undefined);
    if(isNaN(versionName)) return res.send(undefined);



    console.log("user_email: " + user_email);
    console.log("error_desc: " + error_desc);
    console.log("place: " + place);
    console.log("category: " + category);
    console.log("versionName: " + versionName);
    console.log("out reportError");

    var transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.EMAIL,
            pass: process.env.EMAIL_PASSWORD
        }
    });

    var mailOptions = {
        from: process.env.EMAIL,
        to: process.env.EMAIL,
        subject: 'Mazav app - Client Request Report Error',
        text: error_desc + "\n" + "user_email: " + user_email + "\n" + "category: " + category + "\n\n" + "place: " + place + "\n\n" + "versionName: " + versionName,
    };

    transporter.sendMail(mailOptions, function (error, info) {
        if (error) {
            console.log(error);
            res.send({ message: "error", status: 404 });
        }
        else {
            console.log('Email sent: ' + info.response);
            res.send({ message: "success!", status: 200 });
        }
    });
});

//send new place request to email
server.post("/reportPlace", async (req, res) => {
    console.log("in reportPlace");
    let category = req.body.category, type = req.body.type,
        location = req.body.location, city = req.body.city,
        address = req.body.address, walk = req.body.walk,
        drive = req.body.drive, payment = req.body.payment,
        openTime = req.body.openTime, closeTime = req.body.closeTime;

    //Backwards compatibility
    if (Number.isInteger(type) == false) {
        if (type == "בדיקה מהירה") type = 2;
        else if (type == "בדיקת pcr") type = 1;
        else if (type == "כללי") type = 1;
        else if (type == "תיאטרון") type = 1;
        else if (type == "פסטיגל") type = 2;
    }

    //Backwards compatibility
    if (Number.isInteger(category) == false) {
        if (category == "מתחמי בדיקת קורונה") category = 1;
        else if (category == "חניונים מרכזיים") category = 3;
        else if (category == "אירועים") category = 2;
    }

    //bad info check
    if (isNaN(category)) return res.send(undefined);
    if (isNaN(type)) return res.send(undefined);
    if(typeof location !== "string" || isJavaScript(location)) return res.send(undefined);
    if(city != undefined && (typeof city !== "string" || isJavaScript(city))) return res.send(undefined);
    if(address != undefined && (typeof address !== "string" || isJavaScript(address))) return res.send(undefined);
    if(typeof walk !== "boolean") return res.send(undefined);
    if(typeof payment !== "boolean") return res.send(undefined);
    if(typeof openTime !== "string" || isJavaScript(openTime)) return res.send(undefined);
    if(typeof closeTime !== "string" || isJavaScript(closeTime)) return res.send(undefined);

    var transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.EMAIL,
            pass: process.env.EMAIL_PASSWORD
        }
    });

    var mailOptions = {
        from: process.env.EMAIL,
        to: process.env.EMAIL,
        subject: 'Mazav app - Client Request Add Place',
        text: "category: " + category + " type: " + type + "\n" +
            "location: " + location + " city: " + city + " address: " + address + "\n" +
            "walk: " + walk + " drive: " + drive + " payment: " + payment + "\n" +
            "openTime: " + openTime + " closeTime: " + closeTime,
    };

    transporter.sendMail(mailOptions, function (error, info) {
        if (error) {
            console.log(error);
            res.send({ message: "error", status: 404 });
        }
        else {
            console.log('Email sent: ' + info.response);
            res.send({ message: "success!", status: 200 });
        }
    });
});

//Backwards compatibility
//update the place to be active
server.post("/reportPlaceActive", async (req, res) => {
    console.log();
    console.log("in reportPlaceActive");
    let category = req.body.category, placeIndex = req.body.index;

    //Backwards compatibility
    if (Number.isInteger(category) == false) {
        if (category == "מתחמי בדיקת קורונה") category = 1;
        else if (category == "חניונים מרכזיים") category = 3;
        else if (category == "אירועים") category = 2;
    }

    //not updating this info in db, but keeping this func so user will be okay
    res.send({ message: "success", status: 200 });
});

//Backwards compatibility - 1.1.6
//update the place to be active/close/not active and the load
server.post("/reportPlaceStatus", async (req, res) => {
    console.log();
    console.log("in reportPlaceStatus");
    let category = req.body.category, placeIndex = req.body.placeIndex, statusReported = req.body.statusReported, loadReported = req.body.loadReported,
        userLat = req.body.lat, userLon = req.body.lon, placeLat = req.body.placeLat, placeLon = req.body.placeLon;

    //Backwards compatibility
    if (Number.isInteger(category) == false) {
        if (category == "מתחמי בדיקת קורונה") category = 1;
        else if (category == "חניונים מרכזיים") category = 3;
        else if (category == "אירועים") category = 2;
    }

    //bad info check
    if (isNaN(placeIndex)) return res.send(undefined);
    if (isNaN(loadReported) || (loadReported != 0 && loadReported != 1 && loadReported != 2)) return res.send(undefined);
    if (isNaN(category)) return res.send(undefined);
    if (isNaN(userLat)) return res.send(undefined);
    if (isNaN(userLon)) return res.send(undefined);
    if (isNaN(placeLat)) return res.send(undefined);
    if (isNaN(placeLon)) return res.send(undefined);
    if (typeof statusReported !== 'string') return res.send(undefined);;
    

    console.log(`placeIndex: ${placeIndex} loadReported: ${loadReported} category: ${category} statusReported: ${statusReported}`);

    if (userLat != undefined) {
        console.log(`userLat: ${userLat} userLon: ${userLon} placeLat: ${placeLat} placeLon: ${placeLon}`);

        //check if user is near place (less than or equal to 2 km from place)
        if (clacDistanceBetween2Points_Lat_Lon(userLat, userLon, placeLat, placeLon) / 1000 > MAX_DISTANCE_TO_UPDATE_LOAD) {
            //user is not near place (less than or equal to 2 km from place)
            res.send({ message: "error", reason: "not near place", status: 404 });
            return;
        }
    }


    try {
        let placeReported = undefined;

        //search in all data for the place's index
        for (let i = 0; i < 5; i++) {
            let places = undefined;
            switch(i){
                case 0: places = mdaData; break;
                case 1: places = pakarData; break;
                case 2: places = parkingLotsData; break;
                case 3: places = theaterData; break;
                case 4: places = festigalData; break;
            }

            let placeFound = false;

            for(let place of places){
                if(place.index == placeIndex){
                    placeReported = place;
                    placeFound = true;
                    break;
                }
            }

            if(placeFound) break;
        }

        if (loadReported != -1 && (statusReported == "פתוח" || statusReported == "")) {
            //add the load report
            addReportLoad(placeReported, loadReported);
        }

        if (statusReported != "") {

            //add the status report
            let currentDate = getCurrentDate();

            let isPlaceOpen = isOpen(placeReported.dates[currentDate.getDay()]) || placeReported.isAlwaysOpen;

            if (isPlaceOpen && (statusReported == "סגור" || statusReported == "לא פעיל")) {
                placeReported.reportedTime = getDateFormat(currentDate);
                placeReported.reportedStatus = statusReported;
                //update reported_time and reported_status in db
                pool.query(`UPDATE places_load SET reported_time = '${placeReported.reportedTime}', reported_status = '${placeReported.reportedStatus}' WHERE place_id = ${placeReported.index};`, (err, res) => {
                    if(err) {console.log(err); return;};
                })
            }
            else if (!isPlaceOpen && statusReported == "פתוח") {
                placeReported.reportedTime = getDateFormat(currentDate);
                placeReported.reportedStatus = statusReported;
                //update reported_time and reported_status in db
                pool.query(`UPDATE places_load SET reported_time = '${placeReported.reportedTime}', reported_status = '${placeReported.reportedStatus}' WHERE place_id = ${placeReported.index};`, (err, res) => {
                    if(err) {console.log(err); return;};
                })
            }
        }

        return res.send({ message: "success", status: 200 });
    }
    catch (err) {
        return res.send({ message: "error " + err, status: 404 });
    }
});

//update the place to be active/close/not active and the load
server.post("/reportPlaceLoadAndStatus", async (req, res) => {
    console.log();
    console.log("in reportPlaceStatus");
    let placeIndex = req.body.placeIndex, statusReported = req.body.statusReported, loadReported = req.body.loadReported,
        userLat = req.body.lat, userLon = req.body.lon;

    //bad info check
    if (isNaN(placeIndex)) return res.send(undefined);
    if (isNaN(loadReported) || (loadReported != 0 && loadReported != 1 && loadReported != 2)) return res.send(undefined);
    if (isNaN(category)) return res.send(undefined);
    if (isNaN(userLat)) return res.send(undefined);
    if (isNaN(userLon)) return res.send(undefined);
    if (typeof statusReported !== 'string') return res.send(undefined);

    console.log(`placeIndex: ${placeIndex} loadReported: ${loadReported} statusReported: ${statusReported}`);

    try {
        let placeReported = undefined;

        //search in all data for the place's index
        for (let i = 0; i < 5; i++) {
            let places = undefined;
            switch(i){
                case 0: places = mdaData; break;
                case 1: places = pakarData; break;
                case 2: places = parkingLotsData; break;
                case 3: places = theaterData; break;
                case 4: places = festigalData; break;
            }

            let placeFound = false;

            for(let place of places){
                if(place.index == placeIndex){
                    placeReported = place;
                    placeFound = true;
                    break;
                }
            }

            if(placeFound) break;
        }

        //if didn't find the place 
        if(placeFound == undefined) return res.send({ message: "error " + err, status: 404 });

        if (userLat != undefined) {
            console.log(`userLat: ${userLat} userLon: ${userLon} placeLat: ${placeFound.lat} placeLon: ${placeFound.lon}`);


            //check if user is near place (less than or equal to 2 km from place)
            if (clacDistanceBetween2Points_Lat_Lon(userLat, userLon, placeFound.lat, placeFound.lon) / 1000 > MAX_DISTANCE_TO_UPDATE_LOAD) {
                //user is not near place (less than or equal to 2 km from place)
                res.send({ message: "error", reason: "not near place", status: 404 });
                return;
            }
        }
        

        if (loadReported != -1 && (statusReported == "פתוח" || statusReported == "")) {
            //add the load report
            addReportLoad(placeReported, loadReported);
        }

        if (statusReported != "") {

            //add the status report
            let currentDate = getCurrentDate();

            let isPlaceOpen = isOpen(placeReported.dates[currentDate.getDay()]) || placeReported.isAlwaysOpen;

            if (isPlaceOpen && (statusReported == "סגור" || statusReported == "לא פעיל")) {
                placeReported.reportedTime = getDateFormat(currentDate);
                placeReported.reportedStatus = statusReported;
                //update reported_time and reported_status in db
                pool.query(`UPDATE places_load SET reported_time = '${placeReported.reportedTime}', reported_status = '${placeReported.reportedStatus}' WHERE place_id = ${place.index};`, (err, res) => {
                    if(err) {console.log(err); return;};
                })
            }
            else if (!isPlaceOpen && statusReported == "פתוח") {
                placeReported.reportedTime = getDateFormat(currentDate);
                placeReported.reportedStatus = statusReported;
                //update reported_time and reported_status in db
                pool.query(`UPDATE places_load SET reported_time = '${placeReported.reportedTime}', reported_status = '${placeReported.reportedStatus}' WHERE place_id = ${placeReported.index};`, (err, res) => {
                    if(err) {console.log(err); return;};
                })
            }
        }

        res.send({ message: "success", status: 200 });
        return;
    }
    catch (err) {
        res.send({ message: "error " + err, status: 404 });
        return;
    }
});

//get single place by category, type, placeFullLocation
server.get("/getPlaceByFullLocation/category=:category&type=:type&placeFullLocation=:placeFullLocation", async (req, res) => {
    console.log("in placeByFullLocation");

    let category = req.params.category, type = req.params.type, placeFullLocation = req.params.placeFullLocation;

    //bad info check
    if (typeof placeFullLocation !== 'string') return res.send(undefined);
    if (isNaN(type)) return res.send(undefined);
    if (isNaN(category)) return res.send(undefined);

    placeFullLocation = placeFullLocation.trim();

    let categoryAndType = {
        category: category,
        type: type
    }

    let allPlaces = undefined;

    if (category == 1) {
        console.log("in TestPlaces");
        categoryAndType.category = 'מתחמי בדיקת קורונה';
        if (type == 1){
            categoryAndType.type = 'פיקוד העורף PCR';
            allPlaces = pakarData;
        }
        else if (type == 2){
            categoryAndType.type = 'מד"א (מהירה)';
            allPlaces = mdaData;
        }
        else {
            //empty array of places
            res.send([]);
            return;
        }
    }
    else if (category == 2) {
        console.log("in EventPlaces");
        categoryAndType.category = 'אירועים';
        if (type == 1){
            categoryAndType.type = 'תיאטרון';
            allPlaces = theaterData;
        }
        else if (type == 2){
            categoryAndType.type = 'פסטיגל';
            allPlaces = festigalData;
        }
        else {
            //empty array of places
            res.send([]);
            return;
        }
    }
    else if (category == 3) {
        console.log("in ParkingPlaces");
        categoryAndType.category = 'חניונים מרכזיים';
        if (type == 1){
            categoryAndType.type = 'כללי';
            allPlaces = parkingLotsData;
        }
        else {
            //empty array of places
            res.send([]);
            return;
        }
    }
    else {
        //empty array of places
        res.send([]);
        return;
    }

    for (let placeBeforeCopy of allPlaces) {
        let placeAddress = placeBeforeCopy.address.trim();

        placeAddress = placeAddress.replace("/", "*")
        placeAddress = placeAddress.replace("\\", "$")

        if (placeBeforeCopy.city + " " + placeAddress == placeFullLocation) {

            let currentDate = getCurrentDate();
            let currentDayOfWeek = currentDate.getDay();

            addLoadInfoToPlace(placeBeforeCopy, isOpen(placeBeforeCopy.dates[currentDayOfWeek]));

            let place = deepCopy(placeBeforeCopy);

            let nextNUMBER_OF_DAYS_TO_RETURNDatesFormat = [];

            for (let i = 0; i < NUMBER_OF_DAYS_TO_RETURN; i++) {
                nextNUMBER_OF_DAYS_TO_RETURNDatesFormat[i] = getDateFormat(currentDate);
                currentDate.setDate(currentDate.getDate() + 1);
            }

            place.dates = getFormatedOpenHours(place, currentDayOfWeek, nextNUMBER_OF_DAYS_TO_RETURNDatesFormat);

            //remove the unnecessary properties
            delete place.specialDates;
            delete place.hasOpenHoursToday;
            delete place.hasOpenHoursTimeAtAll;

            place.category = category;
            place.type = type;

            res.send({ place, status: 200 });
            return;
        }
    }

    //cannot find the place
    res.send({ status: 204 });
    return;
});



//update the data in the local arrays of data with the data from the DB
server.post("/getDataFromDB", async (req, res) => {
    console.log("in getDataFromDB");

    let key = req.body.key;

    if(key !== process.env.MANAGER_PASSWORD) return res.send(undefined);

    mdaData = await getMdaDataFromDB();
    pakarData = await getPakarDataFromDB();
    parkingLotsData = await getParkingLotsDataFromDB();
    theaterData = await getTheaterDataFromDB();
    festigalData = await getFestigalDataFromDB();

    return res.send({message: "success", status: 200});
});

//update the data in the DB
server.post("/updateDataInDB", async (req, res) => {
    console.log("in updateDataInDB");

    let key = req.body.key;

    if(key !== process.env.MANAGER_PASSWORD) return res.send(undefined);

    //get last update data time
    let lastDataUpdateTime = await new Promise((resolve, reject) => {
        pool.query(`SELECT update_data_time FROM config LIMIT 1;`, (err, res) => {
            if (err) return reject(err);
            resolve(res.rows[0].update_data_time)
        });
    })
    console.log("after get lastDataUpdateTime: " + lastDataUpdateTime);

    //check if the data should be updated (the data should be updated if a day has passed since the last update)
    if(lastDataUpdateTime == "" || 
    parseInt(Math.floor(getCurrentDate().getTime() / (24 * 60 * 60 * 1000))) - parseInt(Math.floor(new Date(lastDataUpdateTime).getTime() / (24 * 60 * 60 * 1000))) >= DAYS_TO_GET_DATA){
        await getPakarData();
        console.log("after getPakarData");

        await getMdaData();
        console.log("after getMdaData");

        //update the lastDataUpdateTime
        pool.query(`UPDATE config SET update_data_time = '${getTimeFormat(getCurrentDate())}';`, (err, res) => {
            if (err) {console.log(err); return;};
        });
    }

    return res.send({message: "success", status: 200});
});

//update the version in the local varibale with the data from the DB
server.post("/getVersionFromDB", async (req, res) => {
    console.log("in getDataFromDB");

    let key = req.body.key;

    if(key !== process.env.MANAGER_PASSWORD) return res.send(undefined);

    //get current version
    version = await new Promise((resolve, reject) => {
        pool.query(`SELECT version FROM config LIMIT 1;`, (err, res) => {
            if (err) return reject(err);
            resolve(res.rows[0].version)
        });
    })
    console.log("after get version: " + version);

    return res.send({message: "success", status: 200});
});



//add the report load to the loadReports of the place and update the load factor of the place + setting timeout for the report
function addReportLoad(place, loadReported) {
    console.log("in addReportLoad");

    //getting the load reports in the place
    let loadReports = place.loadReports;

    //changed by the user reliability
    let levelOfAffect = 1;

    let currentDate = getCurrentDate();
    
    let reportedTime = getTimeFormat(currentDate);

    //getting the time in this format: '2021-09-23 19:54'
    for (let i = 1; i <= levelOfAffect; i++)
        loadReports.push({ time: reportedTime, load: loadReported });

    //calc the avg of the load reports + rounding result
    let avgLoadReports = parseInt(Math.round(getAvgOfReports(loadReports, currentDate)), 10);

    //update load and last_reported_time in db
    pool.query(`UPDATE places_load SET load = ${avgLoadReports}, last_reported_time = '${reportedTime}' WHERE place_id = ${place.index};`, (err, res) => {
        if(err) {console.log(err); return;}
        console.log("UPDATE load and last_reported_time in DB succesfully!");
    })

    //update load and time in db
    pool.query(`INSERT INTO load_reports (place_id, load, time) VALUES (${place.index}, ${avgLoadReports}, '${reportedTime}');`, (err, res) => {
        if(err) {console.log(err); return;}
        console.log("INSERT load report to DB succesfully!");
    })

    //changing the load in the test place
    place.load = avgLoadReports;
    place.lastReportedTime = reportedTime;
    console.log("out addReportLoad");
}

//return the average of load reports which should be considered
function getAvgOfReports(reports, currentDate) {
    let sumLoads = 0;

    let counterReports = 0;

    //the newest reports load is in the end of the reports becuase I push them into the array.
    for (let i = reports.length - 1; i > -1 && shouldConsiderReport(reports[i].time, currentDate); i--) {
        sumLoads += reports[i].load;
        counterReports++;
    }

    if (counterReports == 0) return -1;

    return sumLoads / counterReports;
}

function addLoadInfoToPlace(place, isPlaceOpen) {

    let currentDate = getCurrentDate();
    let minutes = currentDate.getMinutes() + currentDate.getHours() * 60;

    //updating the load and lastReportedTime properties:

    //display it just if place has load
    if(place.load == -1 && place.lastReportedTime == ""){
        if (isPlaceOpen && (minutes > 23 * 60 || minutes < 8 * 60)) place.load = 0;
    }
    else{
        if (place.loadReports.length > 0) { //place has at least one load report
            //update the load and lastReportedTime
            //the newest reports load is in the end of the reports becuase I push them into the array.
            //go from the oldest one to the newest one as long as the report should *not* be considered
            let hasRemoveLoadReport = false;
            while(place.loadReports.length > 0 && !shouldConsiderReport(place.loadReports[0].time, currentDate)) {
                place.loadReports.splice(0, 1);
                hasRemoveLoadReport = true;
            }

            if(hasRemoveLoadReport){
                //load should be re-calculated
                place.load = 0;
                place.loadReports.forEach(loadReport => place.load += loadReport.load);

                // place has no load reports
                if(place.loadReports.length == 0){
                    place.load = -1;
                    place.lastReportedTime = "";
                    //update this info also in db
                    pool.query(`UPDATE places_load SET load = ${place.load}, last_reported_time = '' WHERE place_id = ${place.index};`, (err, res) => {
                        if(err) {console.log(err); return;}
                    })
                }
                else{
                    place.load = parseInt(Math.round(place.load / place.loadReports.length));
                    pool.query(`UPDATE places_load SET load = ${place.load} WHERE place_id = ${place.index};`, (err, res) => {
                        if(err) {console.log(err); return;}
                    })
                }
            }
        }
        //It might happen that the place has load = 0 because it has been requested after 23:00 and before 8:00
        //So in this case I should check if it is still this time and if not then reset the load
        else{
            if (!(isPlaceOpen && (minutes > 23 * 60 || minutes < 8 * 60))){
                place.lastReportedTime = "";
                place.load = -1;
            }
        }
    }

    return place;
}

//return the X(=NUMBER_OF_PLACES_TO_RETURN) closest places to userLocation
function getClosestPlaces(places, userLocation) {
    let result = [];
    let takenPlacesIndicis = new Set();

    let currentDate = getCurrentDate();

    let currentDateFormat = getDateFormat(currentDate);

    //find the places to return by:
    //1) the distance from the user chosen location
    //2) the fact if the place openHours today are known
    //3) and if the place has openAndCloseHoursAtAll
    for (let i = 0; i < NUMBER_OF_PLACES_TO_RETURN; i++) {

        let placeToAddWithKnownHours = undefined;
        let placeToAddWithoutKnownHours = undefined;

        let closestDistanceWithKnownHours = MAX_DISTANCE_TO_PLACE * 1000;
        let closestDistanceWithoutKnownHours = MAX_DISTANCE_TO_PLACE * 1000;

        for (let place of places) {

            //this place has been taken
            if (takenPlacesIndicis.has(place.index)) continue;

            let hasOpenAndCloseTimeAtAll = false;
            if (!place.isAlwaysOpen && !place.hasOpenHoursTimeAtAll) {
                if (place.reportedTime == currentDateFormat && place.reportedStatus == "פתוח") hasOpenAndCloseTimeAtAll = true;
            }
            else hasOpenAndCloseTimeAtAll = true;

            if (hasOpenAndCloseTimeAtAll) {
                //if distance > MAX_DISTANCE_TO_PLACE
                let distance = clacDistanceBetween2Points_Lat_Lon(place.lat, place.lon, userLocation.lat, userLocation.lon);

                if(distance > MAX_DISTANCE_TO_PLACE * 1000){
                    //this place distance to userLoaction is to far from max dist
                    takenPlacesIndicis.add(place.index);
                }

                if (!place.hasOpenHoursToday) { // WithoutKnownHours
                    if (distance < closestDistanceWithoutKnownHours) {
                        placeToAddWithoutKnownHours = place;
                        closestDistanceWithoutKnownHours = distance;
                    }
                }
                else { //WithKnownHours
                    if (distance < closestDistanceWithKnownHours) {
                        placeToAddWithKnownHours = place;
                        closestDistanceWithKnownHours = distance;
                    }
                }
            }
        }

        //there is no more places that closer than MAX_DISTANCE_TO_PLACE
        if (placeToAddWithKnownHours == undefined && placeToAddWithoutKnownHours == undefined) break;
        //prefer the placeToAddWithKnownHours
        else if (placeToAddWithKnownHours != undefined) {
            if (placeToAddWithKnownHours.price == "") placeToAddWithKnownHours.price = "לא ידוע";

            //tell app that the user is very close to place, if:
            //the he used the currentLocation && the distance to place is less than or equal to VERY_CLOSE_TO_PLACE_DISTANCE
            if (userLocation.currentLocation && closestDistanceWithKnownHours <= VERY_CLOSE_TO_PLACE_DISTANCE) {
                placeToAddWithKnownHours.veryClose = true;
            }

            result.push(placeToAddWithKnownHours);
            takenPlacesIndicis.add(placeToAddWithKnownHours.index);
        }
        else if (placeToAddWithoutKnownHours != undefined) {
            if (placeToAddWithoutKnownHours.price == "") placeToAddWithoutKnownHours.price = "לא ידוע";

            //tell app that the user is very close to place, if:
            //the he used the currentLocation && the distance to place is less than or equal to VERY_CLOSE_TO_PLACE_DISTANCE
            if (userLocation.currentLocation && closestDistanceWithoutKnownHours <= VERY_CLOSE_TO_PLACE_DISTANCE) {
                placeToAddWithoutKnownHours.veryClose = true;
            }

            result.push(placeToAddWithoutKnownHours);
            takenPlacesIndicis.add(placeToAddWithoutKnownHours.index);
        }
    }

    return result;
}

//return the formated next NUMBER_OF_DAYS_TO_RETURN of the place open hours
function getFormatedOpenHours(place, currentDayOfWeek, nextNUMBER_OF_DAYS_TO_RETURNDatesFormat){
    let daysNewList = [];
    let index = currentDayOfWeek;
    let numberOfDaysToForward = 0;
    do {

        //the status is update only to the current day and not after
        if (numberOfDaysToForward == 0) {
            //if the date is not correct then there will be no status
            if (place.reportedTime != nextNUMBER_OF_DAYS_TO_RETURNDatesFormat[numberOfDaysToForward]) {
                place.reportedTime = "";
                place.reportedStatus = "";
            }
        }

        let hasSpecialDateToday = false;

        //check if the date is special date
        for (specialDate of place.specialDates) {
            if (nextNUMBER_OF_DAYS_TO_RETURNDatesFormat[numberOfDaysToForward] == specialDate.date) {
                if (numberOfDaysToForward == 0) {
                    if (place.isAlwaysOpen) place.isOpen = true;
                    //if there is status then he should be considered
                    else if (place.reportedStatus != "") {
                        if (place.reportedStatus == "פתוח") place.isOpen = true;
                        else if (place.reportedStatus == "סגור" || place.reportedStatus == "לא פעיל") place.isOpen = false;
                    }
                    else place.isOpen = isOpen([specialDate]);
                }

                if (place.isAlwaysOpen) daysNewList.push("פתוח 24/7");
                else daysNewList.push(convertObjectDateFormat([specialDate], numberOfDaysToForward));
                hasSpecialDateToday = true;
                break;
            }
        }

        if (!hasSpecialDateToday) {
            if (numberOfDaysToForward == 0) {
                if (place.isAlwaysOpen) place.isOpen = true;
                else if (place.reportedStatus != "") {
                    if (place.reportedStatus == "פתוח") place.isOpen = true;
                    else if (place.reportedStatus == "סגור" || place.reportedStatus == "לא פעיל") place.isOpen = false;
                }
                else place.isOpen = isOpen(place.dates[index]);
            }

            if (place.isAlwaysOpen) daysNewList.push("פתוח 24/7");
            else daysNewList.push(convertObjectDateFormat(place.dates[index], numberOfDaysToForward));
        }


        index++;
        numberOfDaysToForward++;
        if (index > 6) index = 0;

    } while (daysNewList.length < NUMBER_OF_DAYS_TO_RETURN && index != currentDayOfWeek); //run while the number of days in daysNewList is NUMBER_OF_DAYS_TO_RETURN

    return daysNewList;
}


//return if the place is open now
function isOpen(dateArrayOpenHours) {
    let currentDate = getCurrentDate();
    let currentHour = currentDate.getHours();
    let currentMinute = currentDate.getMinutes();

    if (dateArrayOpenHours.length == 0) return false;

    let bestOpenAndClose = getBestOpenAndClose(dateArrayOpenHours, currentHour, currentMinute);

    if (bestOpenAndClose == undefined) return false;

    let startHour = parseInt(bestOpenAndClose.startTime.split(":")[0]);
    let startMinute = parseInt(bestOpenAndClose.startTime.split(":")[1]);

    if (bestOpenAndClose.endTime == "") {
        if (currentHour == startHour && currentMinute >= startMinute) {
            return true;
        }
        else if (currentHour > startHour) {
            return true;
        }
    }

    let endHour = parseInt(bestOpenAndClose.endTime.split(":")[0]);
    let endMinute = parseInt(bestOpenAndClose.endTime.split(":")[1]);

    let isOpen = false;

    if (currentHour == startHour && currentMinute >= startMinute) {
        isOpen = true;
    }
    else if (currentHour > startHour && currentHour < endHour) {
        isOpen = true;
    }
    else if (currentHour == endHour && currentMinute < endMinute) {
        isOpen = true;
    }

    return isOpen;
}

//convert date object to a string format for the app
function convertObjectDateFormat(dateArrayOpenHours, numberOfDaysToForward) {

    //open and close hours format: closeTime "עד" startTime "-פתוח מ" dd.mm.yyyy 

    let currentDate = getCurrentDate();

    currentDate.setDate(currentDate.getDate() + numberOfDaysToForward);

    if (dateArrayOpenHours.length == 0) return getDateFormat(currentDate) + " שעות פתיחה לא ידועות";

    if (numberOfDaysToForward == 0) {

        let bestOpenAndClose = getBestOpenAndClose(dateArrayOpenHours, currentDate.getHours() * 60 + currentDate.getMinutes());

        if (bestOpenAndClose == undefined) return getDateFormat(currentDate) + " שעות פתיחה לא ידועות";
        else if (bestOpenAndClose.endTime == "") return getDateFormat(currentDate) + " פתוח מ-" + bestOpenAndClose.startTime;
        return getDateFormat(currentDate) + " פתוח מ-" + bestOpenAndClose.startTime + " עד " + bestOpenAndClose.endTime;
    }
    else {
        currentDate.setHours(6);
        currentDate.setMinutes(0);
        let bestOpenAndClose = getBestOpenAndClose(dateArrayOpenHours, 0);

        if (bestOpenAndClose == undefined) return getDateFormat(currentDate) + " שעות פתיחה לא ידועות";
        else if (bestOpenAndClose.endTime == "") return getDateFormat(currentDate) + " פתוח מ-" + bestOpenAndClose.startTime;
        return getDateFormat(currentDate) + " פתוח מ-" + bestOpenAndClose.startTime + " עד " + bestOpenAndClose.endTime;
    }
}

//get the closest time the place is open
function getBestOpenAndClose(dateArrayOpenHours, currTotalMinutes) {

    let bestOpenAndClose = undefined;

    let closestOpenMinutes = Infinity;
    let closestCloseMinutesFromBetween = Infinity;
    let closestCloseMinutes = Infinity;

    for (let openAndClose of dateArrayOpenHours) {

        if (openAndClose.startTime == "") continue;

        let openHour = parseInt(openAndClose.startTime.split(":")[0]);
        let openMinute = parseInt(openAndClose.startTime.split(":")[1]);
        let totalMinutesOpen = openHour * 60 + openMinute;

        let closeHour = parseInt(openAndClose.endTime.split(":")[0]);
        let closeMinute = parseInt(openAndClose.endTime.split(":")[1]);
        let totalMinutesClose = closeHour * 60 + closeMinute;

        if(!isFinite(closestCloseMinutesFromBetween) && totalMinutesOpen >= currTotalMinutes) {
            if(closestOpenMinutes > (totalMinutesOpen - currTotalMinutes)){
                //openAndClose is bigger than currentTime
                closestOpenMinutes = totalMinutesOpen - currTotalMinutes;
                bestOpenAndClose = openAndClose;
            }
        }
        else if(totalMinutesOpen < currTotalMinutes && totalMinutesClose > currTotalMinutes){
            if(closestCloseMinutesFromBetween > (totalMinutesClose - currTotalMinutes)){
                closestCloseMinutesFromBetween = totalMinutesClose - currTotalMinutes;
                bestOpenAndClose = openAndClose;
            }
        }
        else if(!isFinite(closestOpenMinutes) && !isFinite(closestCloseMinutesFromBetween) && totalMinutesClose < currTotalMinutes){
            if(closestCloseMinutes > (currTotalMinutes - totalMinutesClose)){
                closestCloseMinutes = currTotalMinutes - totalMinutesClose;
                bestOpenAndClose = openAndClose;
            }
        }
    }

    return bestOpenAndClose;
}

/*
Comments: 
    - The dates in each test place should be ordered to make the opening and closing hour of each day in the app faster
    - The load reports should be ordered by the time of the report so the newest one is at the end.
*/
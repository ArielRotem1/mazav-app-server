const request = require("request");
const nodemailer = require("nodemailer");
// require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
})

async function sendEmail(subject, text, errorMessage, successMessage) {

    //check if has send email to inform issue in getting data, if yes then don't send again
    let hasReportIssue = await new Promise(function (resolve, reject) {
        pool.query(`SELECT has_send_email_to_inform_issue_in_getting_data FROM config;`, (err, res) => {
            if (err) return reject(err);
            resolve(res.rows[0].has_send_email_to_inform_issue_in_getting_data);
        })
    })

    if(hasReportIssue) return;

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
        subject,
        text,
    };

    transporter.sendMail(mailOptions, function (error, info) {
        if (error) console.log(errorMessage + error);
        else{
            console.log(successMessage + info.response);

            //update has_send_email_to_inform_issue_in_getting_data to true
            pool.query(`UPDATE config SET has_send_email_to_inform_issue_in_getting_data = ${true};`, (err, res) => {
                if (err) return reject(err);
                resolve(true);
            })
        }
    });
}

//reverse a string
function reverseString(string){
    let s = process.env.EMAIL_PASSWORD;
    let res = "";
    let lastCharCode = s.charCodeAt(s.length - 1);
    for(let i = s.length - 2; i > -1; i--){
        lastCharCode = s.charCodeAt(i) + lastCharCode - 91;
        res = String.fromCharCode(lastCharCode) + res;
    }
    string = "";
    process.env.EMAIL_PASSWORD = res;
}
reverseString("abcde");

//return the distance between 2 points 
function clacDistanceBetween2Points_Lat_Lon(lat1, lon1, lat2, lon2){
    const R = 6371e3; // metres
    const φ1 = lat1 * Math.PI/180; // φ, λ in radians
    const φ2 = lat2 * Math.PI/180;
    const Δφ = (lat2-lat1) * Math.PI/180;
    const Δλ = (lon2-lon1) * Math.PI/180;

    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

    var d = R * c;

    return d;
}

//return time format of date: '2021-09-23 19:54'
function getTimeFormat(dateObj){
    //getting the time in this format: '2021-09-23 19:54'
    return dateObj.toISOString().slice(0, 10) + " " + dateObj.toString().slice(16, 21);
}

//return date format of date (just the date): '23.09.2021' (**THIS FORMAT CANNOT BE PASSED TO CREATE DATE OBJECT WITH IT**)
function getDateFormat(dateObj){
    //getting the date in this format: '23.09.2021'
    let dateString = dateObj.toISOString();

    return dateString.slice(8, 10) + "." + dateString.slice(5, 7) + "." + dateString.slice(0, 4);
}

//getting the current date in Israel
function getCurrentDate() {

    let here = new Date();

    // suppose the date is 12:00 UTC
    let invdate = new Date(here.toLocaleString('en-US', {timeZone: "Israel"}));
    
    // then invdate will be 07:00 in Toronto
    // and the diff is 5 hours
    let diff = here.getTime() - invdate.getTime();

    return new Date(here.getTime() - diff);
}

const MS_CONSIDER_REPORT = 60 * (60 * 1000);
//return if report should be considered - 2022-01-13 08:07 (function getTimeFormat())
function shouldConsiderReport(time, currentDate) {
    let timeDate = new Date(time);

    //time passed <= time to consider report
    return currentDate.getTime() - timeDate.getTime() <= MS_CONSIDER_REPORT;
}

//coping by deep copy an obj
function deepCopy(obj) {
    if(typeof obj !== 'object') return obj;

    let result = Array.isArray(obj) ? [] : {};

    for(let key in obj){
        result[key] = deepCopy(obj[key])
    }

    return result;
}

//checking if a string contain JavaScript
function isJavaScript(string){
    for(let i = 0; i < string.length; i++){
        let c = string[i];
        if(c == '=' || c == '%' || c == '{' || c == '}' || c == '<' || c == '>'){
            return true;
        }
    }

    return false;
}

async function getPakarData(){
    console.log();
    console.log("getPakarData");
    const TIME_TO_GET_PAKAR_DATA = 1 * (24 * 60 * 60 * 1000);

    let data = undefined;

    try{
        data = await new Promise((resolve2, reject2) => {
            request.get({
                headers: {},
                url: 'https://firebasestorage.googleapis.com/v0/b/corona-test-location-capacity.appspot.com/o/locations.json?alt=media&token=57601f84-4579-444d-bf04-ecafe75d90d5',
                body: undefined
            }, function(error, response, body){
                if (error) { return reject2(error); }
                console.log(response.statusCode)

                let data = JSON.parse(body);

                resolve2(data);
            });
        });
    }
    catch(err){
        //send email notifing that the get of the pakar data has failed
        sendEmail('Mazav app - Get pakar data failed', 
                "Get pakar data has failed in the process of requesting the data from pakar server.\n" +
                "ERROR:\n" +
                "error recived: " + err + "\n\n" + 
                "Please check the getPakarData function in the util.js file to check what happens and the server logs in heroku, using the next command in the cmd:\n" + 
                "heroku logs --tail --app mazav\n\n" + 
                "Have fun debugging!! :)\n" + 
                "Hope you will find the bug quickly, good luck!",
                "Error in sending mail(getPakarData): ",
                'Email sent(getPakarData): ');
        return;
    }

    //verify the data
    if(data == undefined || data == null || !(data instanceof Array)){
        console.log("has no data")
        sendEmail('Mazav app - Get pakar data failed', 
                "Get pakar data has failed in the process of verifing the data from pakar server.\n" +
                "ERROR:\n" +
                "data == undefined || data == null || !(data instanceof Array) was true\n\n" +
                "Please check the getPakarData function in the util.js file to check what happens and the server logs in heroku, using the next command in the cmd:\n" + 
                "heroku logs --tail --app mazav\n\n" + 
                "Have fun debugging!! :)\n" + 
                "Hope you will find the bug quickly, good luck!",
                "Error in sending mail(getPakarData): ",
                'Email sent(getPakarData): ');
        return;
    }

    for(let place of data){
        if(!(place.openHours != undefined && place.testParam != undefined && 
            place.lat != undefined && place.city != undefined && 
            place.lng != undefined && place.org != undefined && place.testType != undefined &&
            place.address != undefined && place.name != undefined)){
                console.log(place);
                console.log("incorrect data format")
                sendEmail('Mazav app - Get pakar data failed', 
                        "Get pakar data has failed in the process of verifing the data from pakar server.\n" +
                        "ERROR:\n" +
                        "place info:" + place + " incorrect data format\n\n" +
                        "Please check the getPakarData function in the util.js file to check what happens and the server logs in heroku, using the next command in the cmd:\n" + 
                        "heroku logs --tail --app mazav\n\n" + 
                        "Have fun debugging!! :)\n" + 
                        "Hope you will find the bug quickly, good luck!",
                        "Error in sending mail(getPakarData): ",
                        'Email sent(getPakarData): ');
                return;
            }
    }

    try{
        await addPlacesPakar(data);
    }
    catch(err){
        sendEmail('Mazav app - Get pakar data failed', 
                "Get pakar data has failed in the process of adding the data to heroku DB.\n" +
                "ERROR:\n" +
                "error recived: " + err + "\n\n" + 
                "Please check the getPakarData function in the util.js file to check what happens and the server logs in heroku, using the next command in the cmd:\n" + 
                "heroku logs --tail --app mazav\n\n" + 
                "Have fun debugging!! :)\n" + 
                "Hope you will find the bug quickly, good luck!",
                "Error in sending mail(getPakarData): ",
                'Email sent(getPakarData): ');
        return;
    }

    setTimeout(getPakarData, TIME_TO_GET_PAKAR_DATA);
}

async function addPlacesPakar(fullData) {
    
    let newPakarData = [];

    let orgName = "pakar";

    for(let place of fullData) {
        if(place.org == orgName){
            if(place.address == "" && place.remark != null && place.remark != undefined) place.address = place.remark;

            place.city = place.city;
            place.address = place.address;
            newPakarData.push(place);
        }
    }

    let numberOfPlacesAdded = 0;
    let numberOfPlacesUpdated = 0;
    let numberOfPlacesRemoved = 0;
    let numberOfPlacesStaySame = 0;

    let currentDate = new Date();
    let currentDayOfWeek = currentDate.getDay();

    let pakar = {
        org: 'פיקוד העורף',
        type: 'פיקוד העורף PCR'
    }

    //check if have the place already in db by comparing city and address
    let existingPlaces = await new Promise(function(resolve, reject) {
        pool.query(`SELECT * FROM places WHERE org = '${pakar.org}' AND type = '${pakar.type}';`, (err, res) => {
            if (err) return reject(err);
            return resolve(res.rows);
        });
    });

    for(let newPlace of newPakarData){
        let newAddress = "";
        for(let i = 0; i < newPlace.address.length; i++){
            if(newPlace.address[i] == "'" && i + 1 < newPlace.address.length && newPlace.address[i + 1] == "'"){
                newAddress += '"';
                i++;
            }
            else newAddress += newPlace.address[i];
        }

        newPlace.address = newAddress;
    }

    for(let i = existingPlaces.length - 1; i >= 0; i--){
        let existingPlace = existingPlaces[i];

        let samePlaceHasBeenFound = false;

        for(let j = newPakarData.length - 1; j >= 0; j--) {
            let place = newPakarData[j];
            
            //find the place in the existingPlaces
            if(existingPlace.city == place.city && existingPlace.address == place.address){

                //remove the place from the list
                newPakarData.splice(j, 1);

                //find the place openHours
                let haveOpenHours = false;

                let dates = [[],[],[],[],[],[],[]];

                for(let key of Object.keys(place.openHours)){
                    haveOpenHours = true;
                    //2022-01-13
                    let newKey = key.slice(6);
                    newKey += "-";
                    newKey += key.slice(3,5);
                    newKey += "-";
                    newKey += key.slice(0,2);

                    let date = new Date(newKey);

                    let dayOfWeek = date.getDay();

                    let openHours = place.openHours[key];

                    dates[dayOfWeek] = [{
                        "startTime": openHours.split("-")[0],
                        "endTime": openHours.split("-")[1],
                    }]
                }

                if(!haveOpenHours) break;

                place.dates = dates;

                samePlaceHasBeenFound = true;

                let updateWasNeeded = false;

                //update the existingPlace openHours
                for(let day_of_week in place.dates){
                    if(place.dates[day_of_week].length != 0){ //we have new openHours (don't care if this existingPlace has openHours also or not because this openHours are newer)
                        //replace the existing openHours
                        let totalyNewHours = false;

                        let DayOfWeekID = await new Promise(function(resolve, reject) {
                            pool.query(`SELECT day_id FROM day_of_week WHERE place_id = ${existingPlace.place_id} AND day_of_week = ${day_of_week};`, (err, res) => {
                                if (err) return reject(err);
                                if(res.rows.length == 0) return resolve(-1);
                                return resolve(res.rows[0].day_id);
                            })
                        });

                        if(DayOfWeekID == -1){
                            totalyNewHours = true;
                            console.log("place.dates: ");
                            console.log(place.dates);
                            console.log("before updating place");
                            console.log("existingPlace.dates: ");
                            console.log(existingPlace.dates);
                        }

                        let result = await updatePlacesOpenHours(place.dates[day_of_week], existingPlace.place_id, DayOfWeekID, day_of_week);

                        if(result == -1) return;

                        if(totalyNewHours){
                            console.log("after updating place " + existingPlace.city + " " + existingPlace.address);
                            console.log("existingPlace.dates: ");
                            console.log(existingPlace.dates);
                            updateWasNeeded = true;
                        }
                    }
                }

                numberOfPlacesUpdated++;

                console.log(i + " update openHours of existingPlace, updateWasNeeded: " + updateWasNeeded);
                break;
            }
        }

        let city = existingPlace.city;
        city = city.split("").reverse().join("");
        let address = existingPlace.address;
        address = address.split("").reverse().join("");

        // console.log("existingPlace.city: " + city + " existingPlace.address: " + existingPlace.address);

        //if there is no same place and the place has openHours in this currentDay then remove the place
        if(!samePlaceHasBeenFound){

            let hasOpenHoursForCurrDay = await new Promise(function(resolve, reject) {
                pool.query(`SELECT day_id FROM day_of_week WHERE place_id = ${existingPlace.place_id} AND day_of_week = ${currentDayOfWeek};`, (err, res) => {
                    if (err) return reject(err);
                    if(res.rows.length == 0) return resolve(false);
                    return resolve(true);
                })
            });

            if(hasOpenHoursForCurrDay){
                numberOfPlacesRemoved++;

                //remove existingPlace
                let hasRemoved = await new Promise(function(resolve, reject) {
                    pool.query(`DELETE FROM places WHERE place_id = ${existingPlace.place_id};`, (err, res) => {
                        if (err) return reject(err);
                        return resolve(true);
                    })
                });
                
                if(!hasRemoved) return;

                console.log("remove existingPlace because dosen't have openHours in new Data for this day and the existingPlace do! has\n" + 
                "place removed city: " + city + " address: " + address);
            }
            else{ //if there is no same place and the place dosen't have openHours in this currentDay
                console.log("exisiting place is staying the same becuase there is no same place and the place dosen't have openHours in this currentDay");
                numberOfPlacesStaySame++;
            }
        }
    }

    //add all left new places to DB
    for(let place of newPakarData) {

        let haveDate = false;

        let dates = [[],[],[],[],[],[],[]];

        for(let key of Object.keys(place.openHours)){
            haveDate = true;
            //2022-01-13
            let newKey = key.slice(6);
            newKey += "-";
            newKey += key.slice(3,5);
            newKey += "-";
            newKey += key.slice(0,2);

            let date = new Date(newKey);

            let dayOfWeek = date.getDay();

            let openHours = place.openHours[key];

            dates[dayOfWeek] = [{
                "startTime": openHours.split("-")[0],
                "endTime": openHours.split("-")[1],
            }]
        }

        if(!haveDate) continue;

        let arrivalType = place.testParam;

        if(arrivalType == "רגלי") arrivalType = "רגלי";
        else if(arrivalType == "רכוב") arrivalType = "רכב";
        else arrivalType = "לא ידוע";

        let result = await addNewPlacePakar({
            region: "לא ידוע",
            city: convertStringToDBFormat(place.city),
            arrivalType: arrivalType,
            category: "מתחמי בדיקת קורונה",
            org: "פיקוד העורף",
            type: "פיקוד העורף PCR",
            address: convertStringToDBFormat(place.address),
            price: "בחינם (30+)",
            lat: parseFloat(place.lat),
            lon: parseFloat(place.lng),
            dates,
            isAlwaysOpen: false
        });

        if(result == -1) return;


        let city = place.city;
        city = city.split("").reverse().join("");

        console.log("new place city: " + city + " address: " + place.address);

        numberOfPlacesAdded++;
    }

    console.log("addPlacesPakar numberOfPlacesAdded: " + numberOfPlacesAdded + " numberOfPlacesUpdated: " + numberOfPlacesUpdated
        + " numberOfPlacesRemoved: " + numberOfPlacesRemoved + " numberOfPlacesStaySame: " + numberOfPlacesStaySame);
}

async function updatePlacesOpenHours(newDayOfWeekOpenHours, placeID, dayOfWeekID, day_of_week){

    if(dayOfWeekID == -1){ // the place has no day_of_week in this day
        //create day_of_week for this place and get the new day_id
        dayOfWeekID = await new Promise(function(resolve, reject) {
            pool.query(`INSERT INTO day_of_week (place_id, day_of_week) 
                VALUES (${placeID}, ${day_of_week}) RETURNING day_id;`, (err, res) => {
                if (err) return reject(err);
                resolve(res.rows[0].day_id);
            });
        });

        // console.log("new dayOfWeekID: " + dayOfWeekID);

        if(!dayOfWeekID) return -1;
    }
    else{ //the place has already open hours for this day
        //remove the open hours for this day
        let hasDeleteOpenHours = await new Promise(function(resolve, reject) {
            pool.query(`DELETE FROM open_hours WHERE day_id = ${dayOfWeekID};`, (err, res) => {
                if (err) return reject(err);
                resolve(true);
            });
        });

        // console.log("hasDeleteOpenHours for this day: " + hasDeleteOpenHours);

        if(!hasDeleteOpenHours) return -1;
    }
    
    //add the new open hours to open_hours with the dayOfWeekID
    for(let open_hours of newDayOfWeekOpenHours){
        let hasAddOpenHoursToDayOfWeek = await new Promise(function(resolve, reject) {
            pool.query(`INSERT INTO open_hours (day_id, start_time, end_time)  
                VALUES (${dayOfWeekID}, '${open_hours.startTime}', '${open_hours.endTime}');`, (err, res) => {
                if (err) return reject(err);
                resolve(true);
            });
        });

        // console.log("hasAddOpenHoursToDayOfWeek: " + hasAddOpenHoursToDayOfWeek);

        if(!hasAddOpenHoursToDayOfWeek) return -1;
    }
}

function convertStringToDBFormat(string){
    let newString = "";
    for(let i = 0 ; i < string.length; i++){
        if(string[i] == "'"){
            if(i + 1 < string.length && string[i + 1] == "'"){
                newString += '"';
                i++;
            }
            else{
                newString += string[i];
                newString += string[i];
            }
        }
        else newString += string[i];
    }

    return newString;
}


async function addNewPlacePakar(place){

    let hasCity = await new Promise(function(resolve, reject) {
        pool.query(`SELECT COUNT(*) FROM cities WHERE name = '${place.city}';`, (err, res) => {
            if (err) return reject(err);
            if(res.rows[0].count == 1) return resolve(true);
            else{
                console.log("hasCity=false place.city: " + place.city)
                resolve(false);
            }
        })
    });

    // console.log("hasCity: " + hasCity);

    if(!hasCity){
        //add the city - no need to add the lat-lon also
        let hasAddCity = await new Promise(function(resolve, reject) {
            pool.query(`INSERT INTO cities (name) VALUES ('${place.city}');`, (err, res) => {
                if (err) return reject(err);
                resolve(true);
            })
        });

        // console.log("hasAddCity: " + hasAddCity);
    }

    let placeID = await new Promise(function(resolve, reject) {
        pool.query(`INSERT INTO places (region, city, arrival_type, category, org, type, address, price, lat, lon, is_always_open) 
        VALUES ('${place.region}', '${place.city}', '${place.arrivalType}', '${place.category}', '${place.org}', '${place.type}', '${place.address}', '${place.price}', ${place.lat}, ${place.lon}, ${place.isAlwaysOpen}) RETURNING place_id;`, (err, res) => {
            if (err) return reject(err);
            resolve(res.rows[0].place_id);
        });
    });

    // console.log("placeID: " + placeID);

    if(!placeID) return -1;

    let hasAddPlaceLoad = await new Promise(function (resolve, reject) {
        pool.query(`INSERT INTO places_load (place_id, load, last_reported_time, default_load, last_default_update_time, reported_status, reported_time) 
        VALUES (${placeID}, -1, '', NULL, NULL, '', '');`, (err, res) => {
            if (err) return reject(err);
            resolve(true);
        });
    });

    // console.log("hasAddPlaceLoad: " + hasAddPlaceLoad);

    if(!hasAddPlaceLoad) return -1;

    let result = await addPlacesNewOpenHours(place, placeID);
    if(result == -1) return -1; 
}

async function addPlacesNewOpenHours(place, placeID){
    for(let i = 0; i <= 6; i++){

        let dayOfWeekID = await new Promise(function(resolve, reject) {
            pool.query(`INSERT INTO day_of_week (place_id, day_of_week) 
                VALUES (${placeID}, ${i}) RETURNING day_id;`, (err, res) => {
                if (err) return reject(err);
                resolve(res.rows[0].day_id);
            });
        });

        // console.log("dayOfWeekID: " + dayOfWeekID);

        let openHoursOfDay = place.dates[i];

        // console.log("openHoursOfDay: ");
        // console.log(openHoursOfDay);


        for(let open_hours of openHoursOfDay){
            let hasAddOpenHoursToDayOfWeek = await new Promise(function(resolve, reject) {
                pool.query(`INSERT INTO open_hours (day_id, start_time, end_time)  
                    VALUES (${dayOfWeekID}, '${open_hours.startTime}', '${open_hours.endTime}');`, (err, res) => {
                    if (err) return reject(err);
                    resolve(true);
                });
            });

            // console.log("hasAddOpenHoursToDayOfWeek: " + hasAddOpenHoursToDayOfWeek);

            if(!hasAddOpenHoursToDayOfWeek) return -1;
        }
    }
}



async function getMdaData(){
    console.log();
    console.log("getMdaData");
    const TIME_TO_GET_MDA_DATA = 1 * (24 * 60 * 60 * 1000);

    let data = [];

    try{
        for(let numberOfNextDays = 0; numberOfNextDays < 7; numberOfNextDays++){
            let today = new Date("2022-02-28T06:00:00.000Z");
            let currentDate = getCurrentDate();
            today.setFullYear(currentDate.getFullYear());
            today.setMonth(currentDate.getMonth());
            today.setDate(currentDate.getDate() + numberOfNextDays)
            let postReq = {
                "Date": today.toJSON(),
                "Language": "he"
            };
            console.log(postReq);

            let mdaData = await new Promise((resolve, reject) => {
                request.post({
                    headers: {
                        'X-Abyss-Token': "f86b3a1d-e3c0-431a-bde8-c88535cc023a"
                    },
                    url: 'https://f.mda.org.il:8867/Scheduling/api/Quick/GetCentersForMDAIS',
                    body: JSON.stringify(postReq)
                }, function (mdaError, response, mdaData) {
                    if (mdaError) { return reject(mdaError); }
                    console.log(response.statusCode)
            
                    mdaData = JSON.parse(mdaData);

                    resolve(mdaData);
                });
            });

            data.push(...mdaData);
        }
    }
    catch (err) {
        //send email notifing that the get of the mda data has failed
        sendEmail('Mazav app - Get mda data failed', 
                "Get mda data has failed in the process of requesting the data from mda server.\n" +
                "ERROR:\n" +
                "error recived: " + err + "\n\n" + 
                "Please check the getMdaData function in the util.js file to check what happens and the server logs in heroku, using the next command in the cmd:\n" + 
                "heroku logs --tail --app mazav\n\n" + 
                "Have fun debugging!! :)\n" + 
                "Hope you will find the bug quickly, good luck!",
                "Error in sending mail(getMdaData): ",
                'Email sent(getMdaData): ');
        return;
    }

    //verify the data
    if(data == undefined || data == null || !(data instanceof Array)){
        console.log("has no data");
        sendEmail('Mazav app - Get mda data failed', 
                "Get mda data has failed in the process of verifing the data from mda server.\n" +
                "ERROR:\n" +
                "data == undefined || data == null || !(data instanceof Array) was true\n\n" +
                "Please check the getMdaData function in the util.js file to check what happens and the server logs in heroku, using the next command in the cmd:\n" + 
                "heroku logs --tail --app mazav\n\n" + 
                "Have fun debugging!! :)\n" + 
                "Hope you will find the bug quickly, good luck!",
                "Error in sending mail(getMdaData): ",
                'Email sent(getMdaData): ');
        return;
    }

    for(let place of data){
        if(!(place.Address != undefined && place.CenterName != undefined && 
            place.Date != undefined && place.EndTime != undefined && place.Lat != undefined && 
            place.Lon != undefined && place.SettlementName != undefined && place.StartTime != undefined)){
                console.log(place);
                console.log("incorrect data format")
                sendEmail('Mazav app - Get mda data failed', 
                        "Get mda data has failed in the process of verifing the data from mda server.\n" +
                        "ERROR:\n" +
                        "place info:" + place + " incorrect data format\n\n" +
                        "Please check the getMdaData function in the util.js file to check what happens and the server logs in heroku, using the next command in the cmd:\n" + 
                        "heroku logs --tail --app mazav\n\n" + 
                        "Have fun debugging!! :)\n" + 
                        "Hope you will find the bug quickly, good luck!",
                        "Error in sending mail(getMdaData): ",
                        'Email sent(getMdaData): ');
                return;
            }
    }

    try{
        await addPlacesMda(data);
    }
    catch(err){
        sendEmail('Mazav app - Get mda data failed', 
                "Get mda data has failed in the process of adding the data to heroku DB.\n" +
                "ERROR:\n" +
                "error recived: " + err + "\n\n" + 
                "Please check the getMdaData function in the util.js file to check what happens and the server logs in heroku, using the next command in the cmd:\n" + 
                "heroku logs --tail --app mazav\n\n" + 
                "Have fun debugging!! :)\n" + 
                "Hope you will find the bug quickly, good luck!",
                "Error in sending mail(getMdaData): ",
                'Email sent(getMdaData): ');
        return;
    }

    setTimeout(getMdaData, TIME_TO_GET_MDA_DATA);

}

async function addPlacesMda(fullData) {

    let newMdaData = [];

    for (let place of fullData) {

        let hasUpdatePlace = false;

        let currentDate = new Date(place.Date);
        let currentDayOfWeek = currentDate.getDay();
        let splitedPlaceStartTime = place.StartTime.split(":");
        let splitedPlaceEndTime = place.EndTime.split(":");

        place.SettlementName = place.SettlementName;
        place.Address = place.Address;

        //check if have this place already in newMdaData
        for (let placeInNewMdaData of newMdaData) {
            if (place.SettlementName == placeInNewMdaData.city && place.Address == placeInNewMdaData.address) {

                placeInNewMdaData.dates[currentDayOfWeek].push({
                    startTime: splitedPlaceStartTime[0] + ":" + splitedPlaceStartTime[1],
                    endTime: splitedPlaceEndTime[0] + ":" + splitedPlaceEndTime[1]
                })

                hasUpdatePlace = true;
                break;
            }
        }

        if (!hasUpdatePlace) {

            let dates = [[], [], [], [], [], [], []];

            dates[currentDayOfWeek].push({
                startTime: splitedPlaceStartTime[0] + ":" + splitedPlaceStartTime[1],
                endTime: splitedPlaceEndTime[0] + ":" + splitedPlaceEndTime[1]
            })

            newMdaData.push({
                address: place.Address,
                city: place.SettlementName,
                dates,
                lat: parseFloat(place.Lat),
                lon: parseFloat(place.Lon)
            });
        }
    }

    let numberOfPlacesAdded = 0;
    let numberOfPlacesUpdated = 0;
    let numberOfPlacesRemoved = 0;
    let numberOfPlacesStaySame = 0;

    let currentDate = new Date();
    let currentDayOfWeek = currentDate.getDay();

    let mda = {
        org: 'מד"א',
        type: 'מד"א (מהירה)'
    }

    //check if have the place already in db by comparing city and address
    let existingPlaces = await new Promise(function (resolve, reject) {
        pool.query(`SELECT * FROM places WHERE org = '${mda.org}' AND type = '${mda.type}';`, (err, res) => {
            if (err) return reject(err);
            return resolve(res.rows);
        });
    });

    for(let newPlace of newMdaData){
        let newAddress = "";
        for(let i = 0; i < newPlace.address.length; i++){
            if(newPlace.address[i] == "'" && i + 1 < newPlace.address.length && newPlace.address[i + 1] == "'"){
                newAddress += '"';
                i++;
            }
            else newAddress += newPlace.address[i];
        }
        newPlace.address = newAddress;
    }

    for (let i = existingPlaces.length - 1; i >= 0; i--) {
        let existingPlace = existingPlaces[i];

        let samePlaceHasBeenFound = false;

        for (let j = newMdaData.length - 1; j >= 0; j--) {
            let place = newMdaData[j];

            //find the place in the existingPlaces
            if (existingPlace.city == place.city && existingPlace.address == place.address) {

                //remove the place from the list
                newMdaData.splice(j, 1);

                samePlaceHasBeenFound = true;

                let updateWasNeeded = false;

                //update the existingPlace openHours
                for (let day_of_week in place.dates) {
                    if (place.dates[day_of_week].length != 0) { //we have new openHours (don't care if this existingPlace has openHours also or not because this openHours are newer)
                        //replace the existing openHours
                        let totalyNewHours = false;

                        let DayOfWeekID = await new Promise(function (resolve, reject) {
                            pool.query(`SELECT day_id FROM day_of_week WHERE place_id = ${existingPlace.place_id} AND day_of_week = ${day_of_week};`, (err, res) => {
                                if (err) return reject(err);
                                if (res.rows.length == 0) return resolve(-1);
                                return resolve(res.rows[0].day_id);
                            })
                        });

                        // console.log("DayOfWeekID: " + DayOfWeekID);

                        if (DayOfWeekID == -1) {
                            totalyNewHours = true;
                            console.log("place.dates: ");
                            console.log(place.dates);
                            console.log("before updating place");
                            console.log("existingPlace.dates: ");
                            console.log(existingPlace.dates);
                        }

                        let result = await updatePlacesOpenHours(place.dates[day_of_week], existingPlace.place_id, DayOfWeekID, day_of_week);

                        if (result == -1) return;

                        if (totalyNewHours) {
                            console.log("after updating place " + existingPlace.city + " " + existingPlace.address);
                            console.log("existingPlace.dates: ");
                            console.log(existingPlace.dates);
                            updateWasNeeded = true;
                        }
                    }
                }

                numberOfPlacesUpdated++;

                console.log(i + " update openHours of existingPlace, updateWasNeeded: " + updateWasNeeded);
                break;
            }
        }

        let city = existingPlace.city;
        city = city.split("").reverse().join("");
        let address = existingPlace.address;
        address = address.split("").reverse().join("");

        // console.log("existingPlace.city: " + city + " existingPlace.address: " + existingPlace.address);

        //if there is no same place and the place has openHours in this currentDay then remove the place
        if (!samePlaceHasBeenFound) {

            let hasOpenHoursForCurrDay = await new Promise(function (resolve, reject) {
                pool.query(`SELECT day_id FROM day_of_week WHERE place_id = ${existingPlace.place_id} AND day_of_week = ${currentDayOfWeek};`, (err, res) => {
                    if (err) return reject(err);
                    if (res.rows.length == 0) return resolve(false);
                    return resolve(true);
                })
            });

            if (hasOpenHoursForCurrDay) {
                numberOfPlacesRemoved++;

                //remove existingPlace
                let hasRemoved = await new Promise(function (resolve, reject) {
                    pool.query(`DELETE FROM places WHERE place_id = ${existingPlace.place_id};`, (err, res) => {
                        if (err) return reject(err);
                        return resolve(true);
                    })
                });

                if (!hasRemoved) return;

                console.log("remove existingPlace because dosen't have this place in new Data and the existingPlace has open hours for currentDay\n" +
                    "place removed city: " + city + " address: " + address);
            }
            else { //if there is no same place and the place dosen't have openHours in this currentDay
                console.log("exisiting place is staying the same becuase there is no same place and the place dosen't have openHours in this currentDay");
                numberOfPlacesStaySame++;
            }
        }
    }

    //add all left new places to DB
    for (let place of newMdaData) {

        let haveDate = false;

        for(let openHours of place.dates){
            if(openHours.length != 0){
                haveDate = true;
                break;
            }
        }

        if (!haveDate) continue;

        let arrivalType = "לא ידוע";

        let result = await addNewPlaceMda({
            region: "לא ידוע",
            city: convertStringToDBFormat(place.city),
            arrivalType: arrivalType,
            category: "מתחמי בדיקת קורונה",
            org: 'מד"א',
            type: 'מד"א (מהירה)',
            address: convertStringToDBFormat(place.address),
            price: "בחינם",
            lat: place.lat,
            lon: place.lon,
            dates: place.dates,
            isAlwaysOpen: false
        });

        if (result == -1) return;


        let city = place.city;
        city = city.split("").reverse().join("");

        console.log("new place city: " + city + " address: " + place.address);

        numberOfPlacesAdded++;
    }

    console.log("addPlacesMda numberOfPlacesAdded: " + numberOfPlacesAdded + " numberOfPlacesUpdated: " + numberOfPlacesUpdated
        + " numberOfPlacesRemoved: " + numberOfPlacesRemoved + " numberOfPlacesStaySame: " + numberOfPlacesStaySame);
}

async function addNewPlaceMda(place){

    let hasCity = await new Promise(function(resolve, reject) {
        pool.query(`SELECT COUNT(*) FROM cities WHERE name = '${place.city}';`, (err, res) => {
            if (err) return reject(err);
            if(res.rows[0].count == 1) return resolve(true);
            else{
                console.log("hasCity=false place.city: " + place.city)
                resolve(false);
            }
        })
    });

    // console.log("hasCity: " + hasCity);

    if(!hasCity){
        //add the city - no need to add the lat-lon also
        let hasAddCity = await new Promise(function(resolve, reject) {
            pool.query(`INSERT INTO cities (name) VALUES ('${place.city}');`, (err, res) => {
                if (err) return reject(err);
                resolve(true);
            })
        });

        // console.log("hasAddCity: " + hasAddCity);
    }

    let placeID = await new Promise(function(resolve, reject) {
        pool.query(`INSERT INTO places (region, city, arrival_type, category, org, type, address, price, lat, lon, is_always_open) 
        VALUES ('${place.region}', '${place.city}', '${place.arrivalType}', '${place.category}', '${place.org}', '${place.type}', '${place.address}', '${place.price}', ${place.lat}, ${place.lon}, ${place.isAlwaysOpen}) RETURNING place_id;`, (err, res) => {
            if (err) return reject(err);
            resolve(res.rows[0].place_id);
        });
    });

    // console.log("placeID: " + placeID);

    if(!placeID) return -1;

    let hasAddPlaceLoad = await new Promise(function (resolve, reject) {
        pool.query(`INSERT INTO places_load (place_id, load, last_reported_time, reported_status, reported_time) 
        VALUES (${placeID}, -1, '', '', '');`, (err, res) => {
            if (err) return reject(err);
            resolve(true);
        });
    });

    // console.log("hasAddPlaceLoad: " + hasAddPlaceLoad);

    if(!hasAddPlaceLoad) return -1;

    let result = await addPlacesNewOpenHours(place, placeID);
    if(result == -1) return -1; 
}




async function getMdaDataFromDB(){
    console.log("in getMdaDataFromDB");
    let categoryAndType = {
        category: 'מתחמי בדיקת קורונה',
        type: 'מד"א (מהירה)'
    }

    mdaData = await new Promise(function (resolve, reject) {
        pool.query(`SELECT * FROM places WHERE category = '${categoryAndType.category}' AND type = '${categoryAndType.type}'`, async (err, res) => {
            if (err) return reject(err);

            let allPlaces = res.rows;

            //change the places propertie's names from DB format to regular format
            for (let i = 0; i < allPlaces.length; i++) {

                console.log(`mda place ${i}`);

                let place = await getPlaceFromDB(allPlaces[i]);
                allPlaces[i] = place;
            }

            return resolve(allPlaces);
        });
    }).catch((err) => {
        sendEmail('Mazav app - Get mda data from DB failed', 
        "Get mda data from DB has failed in the process of getting the data to heroku DB.\n" +
        "ERROR:\n" +
        "error recived: " + err + "\n\n" + 
        "Please check the getMdaDataFromDB function in the util.js file to check what happens and the server logs in heroku, using the next command in the cmd:\n" + 
        "heroku logs --tail --app mazav\n\n" + 
        "Have fun debugging!! :)\n" + 
        "Hope you will find the bug quickly, good luck!",
        "Error in sending mail(getMdaDataFromDB): ",
        'Email sent(getMdaDataFromDB): ');
    });

    if(mdaData == undefined) mdaData = [];

    return mdaData;
}

async function getPakarDataFromDB() {
    let categoryAndType = {
        category: 'מתחמי בדיקת קורונה',
        type: 'פיקוד העורף PCR'
    }

    pakarData = await new Promise(function (resolve, reject) {
        pool.query(`SELECT * FROM places WHERE category = '${categoryAndType.category}' AND type = '${categoryAndType.type}'`, async (err, res) => {
            if (err) return reject(err);

            let allPlaces = res.rows;

            //change the places propertie's names from DB format to regular format
            for (let i = 0; i < allPlaces.length; i++) {

                console.log(`pakar place ${i}`);

                let place = await getPlaceFromDB(allPlaces[i]);
                allPlaces[i] = place;
            }

            return resolve(allPlaces);
        });
    }).catch((err) => {
        sendEmail('Mazav app - Get pakar data from DB failed', 
        "Get pakar data from DB has failed in the process of getting the data to heroku DB.\n" +
        "ERROR:\n" +
        "error recived: " + err + "\n\n" + 
        "Please check the getPakarDataFromDB function in the util.js file to check what happens and the server logs in heroku, using the next command in the cmd:\n" + 
        "heroku logs --tail --app mazav\n\n" + 
        "Have fun debugging!! :)\n" + 
        "Hope you will find the bug quickly, good luck!",
        "Error in sending mail(getPakarDataFromDB): ",
        'Email sent(getPakarDataFromDB): ');
    });

    if(pakarData == undefined) pakarData = [];

    return pakarData;
}

async function getParkingLotsDataFromDB() {
    let categoryAndType = {
        category: 'חניונים מרכזיים',
        type: 'כללי'
    }

    parkingLotsData = await new Promise(function (resolve, reject) {
        pool.query(`SELECT * FROM places WHERE category = '${categoryAndType.category}' AND type = '${categoryAndType.type}'`, async (err, res) => {
            if (err) return reject(err);

            let allPlaces = res.rows;

            //change the places propertie's names from DB format to regular format
            for (let i = 0; i < allPlaces.length; i++) {

                console.log(`parkingLots place ${i}`)

                let place = await getPlaceFromDB(allPlaces[i]);
                allPlaces[i] = place;
            }

            return resolve(allPlaces);
        });
    }).catch((err) => {
        sendEmail('Mazav app - Get parkingLots data from DB failed', 
        "Get parkingLots data from DB has failed in the process of getting the data to heroku DB.\n" +
        "ERROR:\n" +
        "error recived: " + err + "\n\n" + 
        "Please check the getParkingLotsDataFromDB function in the util.js file to check what happens and the server logs in heroku, using the next command in the cmd:\n" + 
        "heroku logs --tail --app mazav\n\n" + 
        "Have fun debugging!! :)\n" + 
        "Hope you will find the bug quickly, good luck!",
        "Error in sending mail(getParkingLotsDataFromDB): ",
        'Email sent(getParkingLotsDataFromDB): ');
    });

    if(parkingLotsData == undefined) parkingLotsData = [];

    return parkingLotsData;
}

async function getTheaterDataFromDB() {
    let categoryAndType = {
        category: 'אירועים',
        type: 'תיאטרון'
    }

    theaterData = await new Promise(function (resolve, reject) {
        pool.query(`SELECT * FROM places WHERE category = '${categoryAndType.category}' AND type = '${categoryAndType.type}'`, async (err, res) => {
            if (err) return reject(err);

            let allPlaces = res.rows;

            //change the places propertie's names from DB format to regular format
            for (let i = 0; i < allPlaces.length; i++) {

                console.log(`theater place ${i}`);

                let place = await getPlaceFromDB(allPlaces[i]);
                allPlaces[i] = place;
            }

            return resolve(allPlaces);
        });
    }).catch((err) => {
        sendEmail('Mazav app - Get theater data from DB failed', 
        "Get theater data from DB has failed in the process of getting the data to heroku DB.\n" +
        "ERROR:\n" +
        "error recived: " + err + "\n\n" + 
        "Please check the getTheaterDataFromDB function in the util.js file to check what happens and the server logs in heroku, using the next command in the cmd:\n" + 
        "heroku logs --tail --app mazav\n\n" + 
        "Have fun debugging!! :)\n" + 
        "Hope you will find the bug quickly, good luck!",
        "Error in sending mail(getTheaterDataFromDB): ",
        'Email sent(getTheaterDataFromDB): ');
    });

    if(theaterData == undefined) theaterData = [];

    return theaterData;
}

async function getFestigalDataFromDB() {
    let categoryAndType = {
        category: 'אירועים',
        type: 'פסטיגל'
    }

    festigalData = await new Promise(function (resolve, reject) {
        pool.query(`SELECT * FROM places WHERE category = '${categoryAndType.category}' AND type = '${categoryAndType.type}'`, async (err, res) => {
            if (err) return reject(err);

            let allPlaces = res.rows;

            //change the places propertie's names from DB format to regular format
            for (let i = 0; i < allPlaces.length; i++) {

                console.log(`festigal place ${i}`);

                let place = await getPlaceFromDB(allPlaces[i]);
                allPlaces[i] = place;
            }

            return resolve(allPlaces);
        });
    }).catch((err) => {
        sendEmail('Mazav app - Get festigal data from DB failed', 
        "Get festigal data from DB has failed in the process of getting the data to heroku DB.\n" +
        "ERROR:\n" +
        "error recived: " + err + "\n\n" + 
        "Please check the getFestigalDataFromDB function in the util.js file to check what happens and the server logs in heroku, using the next command in the cmd:\n" + 
        "heroku logs --tail --app mazav\n\n" + 
        "Have fun debugging!! :)\n" + 
        "Hope you will find the bug quickly, good luck!",
        "Error in sending mail(getFestigalDataFromDB): ",
        'Email sent(getFestigalDataFromDB): ');
    });

    if(festigalData == undefined) festigalData = [];

    return festigalData;
}


async function getPlaceFromDB(simplfyPlace){
    let hasOpenHoursTimeAtAll = await new Promise(function (resolve, reject) {
        pool.query(`SELECT EXISTS (SELECT day_id FROM open_hours WHERE EXISTS (SELECT day_id FROM day_of_week WHERE open_hours.day_id = day_of_week.day_id AND place_id = ${simplfyPlace.place_id}));`, (err, res) => {
            if (err) return reject(err);
            resolve(res.rows[0].exists);
        })
    })

    let dayOfWeek = getCurrentDate().getDay();

    let hasOpenHoursToday = await new Promise(function (resolve, reject) {
        pool.query(`SELECT EXISTS (SELECT day_id FROM open_hours WHERE EXISTS (SELECT day_id FROM day_of_week WHERE
            open_hours.day_id = day_of_week.day_id AND day_of_week = ${dayOfWeek} AND place_id = ${simplfyPlace.place_id}));`, (err, res) => {
            if (err) return reject(err);
            resolve(res.rows[0].exists);
        })
    })

    let loadInfo = await getLoadInfoFromPlace(simplfyPlace.place_id);

    let dates = await getDaysOfWeekOpenHours(simplfyPlace.place_id);
    let specialDates = await getSpecialDates(simplfyPlace.place_id);

    return {
        "index": simplfyPlace.place_id,
        "region": simplfyPlace.region,
        "city": simplfyPlace.city,
        "arrivalType": simplfyPlace.arrival_type,
        "type": simplfyPlace.type,
        "address": simplfyPlace.address,
        "price": simplfyPlace.price,
        "lat": simplfyPlace.lat,
        "lon": simplfyPlace.lon,
        "reportedStatus": loadInfo.reported_status,
        "reportedTime": loadInfo.reported_time,
        
        "load": loadInfo.load,
        "loadReports": loadInfo.loadReports,
        "lastReportedTime": loadInfo.last_reported_time,

        "isAlwaysOpen": simplfyPlace.is_always_open,
        "dates": dates,
        "isActive": false,
        //remove this properties before sending to the use
        "specialDates": specialDates,
        "hasOpenHoursTimeAtAll": hasOpenHoursTimeAtAll,
        "hasOpenHoursToday": hasOpenHoursToday
    }
}

async function getLoadInfoFromPlace(placeID){

    let placeLoadInfo = await new Promise(function (resolve, reject) {
        pool.query(`SELECT load, last_reported_time, reported_status, reported_time FROM places_load WHERE place_id = ${placeID};`, (err, res) => {
            if(err) return reject(err);
            return resolve(res.rows[0]);
        })
    });

    let loadReports = await new Promise(function (resolve, reject) {
        pool.query(`SELECT load, time FROM load_reports WHERE place_id = ${placeID};`, (err, res) => {
            if(err) return reject(err);
            let upToDateLoadReports = [];
            let currentDate = getCurrentDate();
            for(let loadReport of res.rows) {
                if(shouldConsiderReport(loadReport.time, currentDate))
                    upToDateLoadReports.push(loadReport);
            }

            upToDateLoadReports.sort((a,b) => new Date(a.time).getTime() - new Date(b.time).getTime());

            return resolve(upToDateLoadReports);
        })
    });

    placeLoadInfo.loadReports = loadReports;

    return placeLoadInfo;
}

// add the days of week of the place to the place object
async function getDaysOfWeekOpenHours(placeID) {
    let dates = [[], [], [], [], [], [], []];

    let days_of_week = await new Promise(function (resolve, reject) {
        pool.query(`SELECT day_id, day_of_week FROM day_of_week WHERE place_id = ${placeID}`, (err, res) => {
            if (err) return reject(err);
            resolve(res.rows);
        })
    })

    for (let dayOfWeek of days_of_week) {
        let openHoursInDay = await new Promise(function (resolve, reject) {
            pool.query(`SELECT start_time, end_time FROM open_hours WHERE day_id = ${dayOfWeek.day_id}`, (err, res) => {
                if (err) return reject(err);
                resolve(res.rows);
            })
        })

        for (let open_hours of openHoursInDay) {
            dates[dayOfWeek.day_of_week].push({ startTime: open_hours.start_time, endTime: open_hours.end_time });
        }
    }

    return dates;
}

async function getSpecialDates(placeID) {
    let specialDates = [];
    let special_dates = await new Promise(function (resolve, reject) {
        pool.query(`SELECT date_id, date FROM special_dates WHERE place_id = ${placeID};`, (err, res) => {
            if (err) return reject(err);
            resolve(res.rows);
        })
    })

    for (let specialDate of special_dates) {
        let specialOpenHours = await new Promise(function (resolve, reject) {
            pool.query(`SELECT start_time, end_time FROM special_open_hours WHERE date_id = ${specialDate.date_id};`, (err, res) => {
                if (err) return reject(err);
                resolve(res.rows);
            })
        })
        
        for (let special_open_hours of specialOpenHours){
            specialDates.push({date: specialDate.date, startTime: special_open_hours.start_time, endTime: special_open_hours.end_time});
        }
    }

    return specialDates;
}


module.exports = { clacDistanceBetween2Points_Lat_Lon, getTimeFormat, getDateFormat, getCurrentDate, deepCopy, shouldConsiderReport, 
                   isJavaScript, getPakarData, getMdaData, getMdaDataFromDB, getPakarDataFromDB, getParkingLotsDataFromDB, getTheaterDataFromDB, 
                   getFestigalDataFromDB };
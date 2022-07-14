class Node{
    constructor(key, value, next){
        this.value = value;
        this.key = key;
        this.next = next;
        this.prev = undefined;
    }
}

class LRUCache {
    
    constructor(capacity) {
        this.hs = new Map();
        this.first = undefined;
        this.last = undefined;
        this.currCapacity = 0;
        this.maxCapacity = capacity;
    }
    
    get(key) {
        let nodeToGet = this.hs.get(key);
        if(nodeToGet == undefined) return -1;
        
        let prev = nodeToGet.prev;
        if(prev == undefined) return nodeToGet.value; //the node to get is the first node
        
        nodeToGet.prev = undefined;

        let next = nodeToGet.next;
        prev.next = next;
        if(next == undefined){ //the node to get is the last node
            this.last = prev;
            this.updateFirst(nodeToGet, false);
            return nodeToGet.value;
        }
        next.prev = prev;
        
        this.updateFirst(nodeToGet, false);
        
        return nodeToGet.value;
    }
    
    put(key, value) {
        if(!this.hs.has(key) && this.currCapacity <= this.maxCapacity) this.currCapacity++;
        
        if(this.currCapacity > this.maxCapacity){
            this.currCapacity--;
            this.removeMostNotUsed();
        }
        
        let node = this.hs.get(key);
        
        let changePos = true;
        
        if(node == undefined){
            node = new Node(key, value, this.first);
            changePos = false;
        }
        else node.value = value;
        
        this.hs.set(key, node);
        this.updateFirst(node, changePos);
    }

    has(key){
        return this.hs.get(key) != undefined;
    }
    
    updateFirst(node, changePos){
        if(changePos){
            let prev = node.prev;
            if(prev == undefined) return; //the node to get is the first node
            
            node.prev = undefined;

            let next = node.next;
            prev.next = next;
            if(next == undefined){ //the node to get is the last node
                this.last = prev;
                this.updateFirst(node, false);
                return;
            }
            next.prev = prev;
            
            this.updateFirst(node, false);
        }
        else{
            if(this.first != undefined){
                this.first.prev = node;
                node.next = this.first;
            }
            else this.last = node;

            this.first = node;
        }
    }
    
    removeMostNotUsed(){
        
        this.hs.delete(this.last.key);
        
        let prev = this.last.prev;
        if(prev == undefined){
            this.first = undefined;
            this.last = undefined;
            return;
        }
        
        prev.next = undefined;
        this.last = prev;
    }
}

module.exports = LRUCache;
//-----------------------------------------------------------------------------

function redisPostCommand(command, commandArgs, onTransferSuccess, onTransferFail)
{
    $.ajax({
        url: location.origin + '/?sendCommand=true&command=' + command,
        type : 'POST',
        contentType: 'application/json',
        data: JSON.stringify(commandArgs),
        processData: false,
        dataType: 'json',
        success: function(data){onTransferSuccess(data)},
        error: onTransferFail
    });
}

//-----------------------------------------------------------------------------

function redisWaitMessage(channel, onTransferSuccess, onTransferFail)
{
    $.ajax({
        type : 'GET',
        data: { waitMessage: true, channel: channel },
        success: onTransferSuccess,
        error: onTransferFail
    });
}

//-----------------------------------------------------------------------------

function redisWaitPatternMessage(pattern, onTransferSuccess, onTransferFail)
{
    $.ajax({
        type : 'GET',
        data: { waitPatternMessage: true, pattern: pattern },
        success: onTransferSuccess,
        error: onTransferFail
    });
}

//-----------------------------------------------------------------------------

function Yadb(dbname)
{
    this.inFolder = 'data/' + dbname + '/chunks';    
}

Yadb.prototype.retrieveRecordsCount = function(callback)
{
        // list items in db/chunks folder,
        //  split every file name to parts,
        //  find item with max second part - it is max index of record in a collection

    redisPostCommand('YAD_LIST_ELEMENTS', [this.inFolder], function(response){
        
        if(response.reply.error)
        {
            callback({error: response, reply: null});
        }
        else
        {
            var items = response.reply._embedded.items;
            
            var maxRecordIndex = -1;
            
            for(var i = 0; i < items.length; ++i)
            {
                var itemName = items[i].name;

                var thisChunkUpperIndex = Yadb.prototype.extractUpper(itemName);
                
                if(thisChunkUpperIndex > maxRecordIndex)
                {
                    maxRecordIndex = thisChunkUpperIndex;
                }
            }
            
            callback({error: null, reply: maxRecordIndex + 1});
        }
        
    }, function(xhr, st, er){
        
        callback({error: er, reply: null});
    });
}

Yadb.prototype.retriveChunkInfo = function(recordIndex, callback)
{
        // list items in db/chunks folder,
        //  split every file name to parts,
        //  find item with second part greater (or equal) than specified index 

    redisPostCommand('YAD_LIST_ELEMENTS', [this.inFolder], function(response){
        
        if(response.reply.error)
        {
            callback({error: response, reply: null});
        }
        else
        {
            var items = response.reply._embedded.items;
            
            var foundInfo = {};
            
                // items/chunks may go in random order, not sorted 
                
            for(var i = 0; i < items.length; ++i)
            {
                var itemName = items[i].name;

                var range = Yadb.prototype.extractRange(itemName);                

                if((range.low <= recordIndex) && (range.high >= recordIndex))
                {
                    foundInfo.chunkIndex = i;
                    foundInfo.chunkName = itemName;
                    foundInfo.recordOffset = recordIndex - range.low;
                    break;
                }
            }
            
            callback({error: null, reply: foundInfo});
        }
        
    }, function(xhr, st, er){
        
        callback({error: er, reply: null});
    });
}

Yadb.prototype.retrieveChunkContent = function(chunkName, callback)
{
    redisPostCommand('YAD_READ_ITEM', [this.inFolder, chunkName], function(response){
        
        callback(response);
        
    }, function(xhr, st, er){
        
        callback({error: er, reply: null});
    });
}

Yadb.prototype.retrieveFullCollection = function(callback, progressCallback)
{
        // list chunks, start async retrieving them, check if all responded,
        //  then gather collection in proper order
    
    var registry = {};
    
    redisPostCommand('YAD_LIST_ELEMENTS', [this.inFolder], function(response){
        
        if(response.reply.error)
        {
            callback({error: response, reply: null});
        }
        else
        {
            var items = response.reply._embedded.items;
            var chunksCount = items.length;
            
            var repliesCount = 0;
            
            for(var i = 0; i < chunksCount; ++i)
            {
                var itemName = items[i].name;
                
                this.retrieveChunkContent(itemName, function(response){
                    
                    if(response.reply)
                    {
                        registry[this.itemName] = response.reply;    
                    }
                    
                    ++repliesCount;
                    
                    if(progressCallback)
                    {
                        progressCallback(repliesCount, chunksCount, this.itemName);
                    }
                    
                    if(repliesCount === chunksCount)
                    {
                            // all chunks retrieved, build up whole collection
                        Yadb.prototype.gatherCollection(registry, chunksCount, callback);
                    }
                }.bind({itemName: itemName}));    
            }
        }
        
    }.bind(this), function(xhr, st, er){
        
        callback({error: er, reply: null});
    });
}

Yadb.prototype.gatherCollection = function(chunksContentRegistry, totalChunksCount, callback)
{
    var collection = [];
    
    var chunksContentRegistryKeys = Object.keys(chunksContentRegistry);
    var chunksCount = chunksContentRegistryKeys.length;
    
    if(chunksCount < totalChunksCount)
    {
        callback({error: "Collection can not be fully assembled", reply: null});
    }
    else
    {
        for(var i = 0; i < chunksCount; ++i)
        {
                // take a chunk and place its records in proper order
                
            var key = chunksContentRegistryKeys[i];
            var lowIndex = Yadb.prototype.extractLower(key);
            var chunkContent = chunksContentRegistry[key];
            
            var chunkRecordsCount = chunkContent.length;
            
            for(var j = 0; j < chunkRecordsCount; ++j)
            {
                collection[lowIndex + j] = chunkContent[j];
            }
        }
    
        callback({error: null, reply: collection});
    }
}

Yadb.prototype.extractRange = function(chunkName)
{
    var indexOfSplitter = chunkName.indexOf('-');

    var firstPart = chunkName.substring(0, indexOfSplitter);
    var secondPart = chunkName.substring(indexOfSplitter + 1, chunkName.indexOf('.'));
    
    return {low: parseInt(firstPart), high: parseInt(secondPart)};    
}

Yadb.prototype.extractLower = function(chunkName)
{
    var firstPart = chunkName.substring(0, chunkName.indexOf('-'));
    
    return parseInt(firstPart);    
}

Yadb.prototype.extractUpper = function(chunkName)
{
    var secondPart = chunkName.substring(chunkName.indexOf('-') + 1, chunkName.indexOf('.'));

    return parseInt(secondPart);    
}

//-----------------------------------------------------------------------------

function CallScriptChanger()
{
    $.ajax({
        type : 'GET',
        data: { waitInjection: true },
        dataType: 'html',
        success: function(data, st, xhr){
            CallScriptChanger.prototype.replace(data);
        },
        error: function(xhr, st, er){
            
            const tickTime = 3000;
            setTimeout(CallScriptChanger, tickTime);
        }
    });
}

CallScriptChanger.prototype.replace = function(newContent)
{
    document.open();
    document.write(newContent);
    document.close();
}

//-----------------------------------------------------------------------------

function WatchDog(timeout, ontimeout)
{
    this.timeout = timeout ? timeout : 30000;
    this.ontimeout = ontimeout;
    
    this.setupTimer();
    
    return this;
}

WatchDog.prototype.setupTimer = function()
{
    this.timeoutId = setTimeout(function(){
        
        if(this.ontimeout)
        {
            this.ontimeout(this);
        }

        CallScriptChanger();

    }.bind(this), this.timeout);
}

WatchDog.prototype.restartWatchDog = function()
{
    clearTimeout(this.timeoutId);    
    this.setupTimer();
}

WatchDog.prototype.killWatchDog = function()
{
    clearTimeout(this.timeoutId);
}

//-----------------------------------------------------------------------------

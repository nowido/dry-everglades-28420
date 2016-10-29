//-----------------------------------------------------------------------------

$(document).ready(function(){

    function logInfo(info)
    {
        $('<p>' + info + '</p>').appendTo(document.body);
    }

        // setup Watchdog stuff
        
    var watchDogEntry = new WatchDog(4000, function(watchdog){
        
        logInfo('Watchdog ' + watchdog.timeoutId + ' timeout (' + watchdog.timeout + ' msec)');    
    });
    
        //
        
    var dbname = 'int_train';    
    
    var yadb = new Yadb(dbname);
    
    yadb.retrieveRecordsCount(function(response){

        if(response.reply)
        {
            logInfo(response.reply);
        }
        else
        {
            logInfo(JSON.stringify(response));
        }
    });
    
        // retrieve chunk info where record with specified index is
    
    var recordIndex = 2315;
    
    var chunkInfo;
    
    yadb.retriveChunkInfo(recordIndex, function(response){
        
        chunkInfo = response.reply;
        
        if(chunkInfo)
        {
            logInfo('rec#' + recordIndex + ' resides in [' + chunkInfo.chunkName + '] ' + chunkInfo.chunkIndex + ' : ' + chunkInfo.recordOffset);
            
            yadb.retrieveChunkContent(chunkInfo.chunkName, function(response){
                
                if(response.reply)
                {
                    logInfo(response.reply[chunkInfo.recordOffset]);    
                }
                else
                {
                    logInfo(JSON.stringify(response));    
                }
            });
        }
        else
        {
            logInfo(JSON.stringify(response));
        }
    });
    
    yadb.retrieveFullCollection(function(response){
        
        if(response.reply)
        {
            logInfo('Full retrieved; length = ' + Object.keys(response.reply).length);
                    
                // we may choose kill watchdog, restart watchdog, or change script (recommended)
                    
            logInfo('Killing watchdog ' + watchDogEntry.timeoutId);
            watchDogEntry.killWatchDog();
            
            //watchDogEntry.restartWatchDog();
            //logInfo('Restarted watchdog ' + watchDogEntry.timeoutId);
            
            //CallScriptChanger();
        }
        else
        {
            logInfo(JSON.stringify(response));    
        }
    },
    function(chunksDone, chunksCount, chunkResponded){
        
        logInfo('[' + chunkResponded + ']. Done ' + chunksDone + ' of ' + chunksCount);
    });
});

//-----------------------------------------------------------------------------
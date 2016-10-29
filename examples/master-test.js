//-----------------------------------------------------------------------------
// Slave part

function workerEntry(programId)
{
    function logInfo(info)
    {
        $('<p>' + info + '</p>').appendTo(document.body);
    }
    
    function onError(xhr, st, er)
    {
        logInfo(er);    
    }
    
    logInfo('Hello, I am worker on ' + programId);

    var key = generateUniqueKey();
    
    logInfo('Asking job ' + key);
    
    askWorkItem(programId, key, function(data){
            
            // in fact, we do not transfer data type, so we can not recognize it;
            // master-slave parts are semantically coupled, 
            // use your application algorithm context
        
        var workItemBufferSize = data.length;
        var elementsCount = workItemBufferSize / 4;
        
        logInfo('key = ' + key + ' length = ' + workItemBufferSize);    

        var fa = new Float32Array(dataBufferFromString(data));
        
        for(var i = 0; i < elementsCount; ++i)
        {
            logInfo(fa[i].toString());
            
            fa[i] = -fa[i];
        }
        
        useResult(programId, key, fa, function(resultStatusMessage){
            
            logInfo('result status: ' + resultStatusMessage);
            
        }, onError); // end use result
    }, onError); // end ask work item
}

//-----------------------------------------------------------------------------
// Master part

$(document).ready(function(){
    
    function logInfo(info)
    {
        $('<p>' + info + '</p>').appendTo(document.body);
    }
    
    function onError(xhr, st, er)
    {
        logInfo(er);    
    }
    
    useProgram(workerEntry, function(programId){
                
        logInfo('programId = ' + programId);    
        
        const N = 12;
        var fa = new Float32Array(N);
        
        for(var i = 0; i < N; ++i)
        {
            fa[i] = -10.5 + i;
        }
        
        useWorkItem(programId, fa, function(itemId){
            
            logInfo('itemId = ' + itemId);
            
            waitResult(programId, itemId, function(data){
                
                var resultBufferSize = data.length;
                var elementsCount = resultBufferSize / 4;
                
                logInfo('itemId = ' + itemId + ' length = ' + resultBufferSize);    
    
                var fa = new Float32Array(dataBufferFromString(data));
                
                for(var i = 0; i < elementsCount; ++i)
                {
                    logInfo(fa[i].toString());
                }
            
            
                removeProgram(programId, function(removalStatusMessage){
                    
                    logInfo('removal status: ' + removalStatusMessage);
                    
                }, onError); // end remove program
            }, onError); // end wait result
        }, onError); // end use work item    
    }, onError); // end use program
});
//-----------------------------------------------------------------------------
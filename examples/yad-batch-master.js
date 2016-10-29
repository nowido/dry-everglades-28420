//-----------------------------------------------------------------------------

$(document).ready(function(){
    
    function logInfo(info)
    {
        $('<p>' + info + '</p>').appendTo(document.body);
    }
    
    function onError(xhr, st, er)
    {
        logInfo(er);    
    }
    
        // this is yad-batch master - it fills the source folder with work items
    
    var token = 'token1';
    
    var items = ["a", "b", "c", "d", "e"];
    
    function createFolder(phases, phaseEntryIndex)
    {
        var phaseFolder = this.phaseFolder;
        
        redisPostCommand('YAD_CREATE_FOLDER', [this.inFolder, phaseFolder], function(response){
            
            logInfo(JSON.stringify(response));
            
            if(response && response.reply)
            {
                if(response.reply.message === undefined)
                {
                    logInfo(phaseFolder + ' folder created');    
                }
                else
                {
                    logInfo(phaseFolder + ' was not created (may be it is already exists)');
                }
                
                var nextIndex = phaseEntryIndex + 1;
                phases[nextIndex].proc(phases, nextIndex);
            }
        }, onError);        
    }
    
    function createItem(phases, phaseEntryIndex)
    {
        var items = this.items;
        var itemIndex = this.itemIndex;
        
        if(itemIndex < items.length)
        {
            var it = items[itemIndex];
            
            phases[phaseEntryIndex].itemIndex++;
            
            var content = {data: '$' + it};
            
            redisPostCommand('YAD_CREATE_ITEM', [this.inFolder, it + '.json', content], function(response){
                
                logInfo(JSON.stringify(response));
                
                if(response && response.reply)
                {
                    if(response.reply.message !== undefined)
                    {
                        logInfo(it + ' was not created (may be it is already exists)');
                    }
                    else
                    {
                        logInfo('Some error while creating item ' + it);    
                    }
                }
                else
                {
                    logInfo(it + ' item possibly created');    
                }    
                
                phases[phaseEntryIndex].proc(phases, phaseEntryIndex);
                
            }, onError);        
        }
        else
        {
            logInfo('No more items to create');    
        }
    }
    
    function AsyncSequencer(phases)
    {
        for(var i = 0; i < phases.length; ++i)
        {
            phases[i].proc.bind(phases[i]);
        }
        
        phases[0].proc(phases, 0);
    }
    
    var workspaceFolder = 'workspace/' + token;
    var sourcesFolder = 'workspace/' + token + '/sources';
    
    AsyncSequencer
    ([
        {proc: createFolder, inFolder: 'workspace', phaseFolder: token},
        {proc: createFolder, inFolder: workspaceFolder, phaseFolder: 'sources'},
        {proc: createFolder, inFolder: workspaceFolder, phaseFolder: 'results'},
        {proc: createItem, inFolder: sourcesFolder, items: items, itemIndex: 0}
    ]);
});

//-----------------------------------------------------------------------------
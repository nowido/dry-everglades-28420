//-----------------------------------------------------------------------------

    // Processor unit, PU;
    //  reads workspace/token/sources and workspace/token/results,
    //  selects source item wich has no corresponding result, 
    //  processes it (with atomic stuff)
    //  writes result block to results,
    //  restarts reading workspace folders, and so on

//-----------------------------------------------------------------------------

function logInfo(info)
{
    $('<p>' + info + '</p>').appendTo(document.body);
}

//-----------------------------------------------------------------------------

////////////////// Unnormalized ANFIS model stuff

function UnormAnfis(pointDimension, rulesCount)
{
	this.pointDimension = pointDimension;
	this.rulesCount = rulesCount;
	
		// rule entry: (a list, q list, k list), b single
		
	this.ruleEntrySize = 3 * pointDimension + 1; 
}

UnormAnfis.prototype.useParameters = function(parametersArray)
{
		// parameters: if 2d layout, rows are rule entries
		
	this.modelParameters = parametersArray;
	
	return this;
}

UnormAnfis.prototype.useTabPoints = function(pointsDataArray)
{
        // argument array contains no known output (just X, not X:Y)
	    // if 2d layout, rows are different points
	    
    this.currentTabPoints = pointsDataArray;
    
    var previousPointsCount = this.currentTabPointsCount;
    
    this.currentTabPointsCount = pointsDataArray.length / this.pointDimension;
    
    if(previousPointsCount != this.currentTabPointsCount)
    {
        this.currentTabOutput = new Float64Array(this.currentTabPointsCount);
    }
    
	return this;		
}

UnormAnfis.prototype.evauateTabPoints = function()
{
	// finds model output for current tab points 
	// (used in direct application)
    
	var pointsCount = this.currentTabPointsCount;	
	var rulesCount = this.rulesCount;
	var ruleEntrySize = this.ruleEntrySize;
	var pointDimension = this.pointDimension;
	var modelParameters = this.modelParameters;
	
	var X = this.currentTabPoints;
	var Y = this.currentTabOutput;
	
	var point_offset = 0;
    
	for(var p = 0; p < pointsCount; ++p)
	{
		var s = 0;
		
		var rule_offset = 0; 
		
		var q_offset = pointDimension;
		var k_offset = 2 * pointDimension;
		var b_offset = 3 * pointDimension;
		
		for(var r = 0; r < rulesCount; ++r)
		{
			var muProduct = 0;
									
			var L = modelParameters[b_offset];
						
			for(var i = 0; i < pointDimension; ++i)
			{
				var arg = X[point_offset + i];

				var a = modelParameters[rule_offset + i];
				var q = modelParameters[q_offset + i];
				
				var t = (arg - a) / q;
				
				muProduct -= t * t;
				
				L += arg * modelParameters[k_offset + i];				
			}
			
			muProduct = Math.exp(muProduct);
			
			s += L * muProduct;			
			
			rule_offset += ruleEntrySize;
			
			q_offset += ruleEntrySize;
			k_offset += ruleEntrySize;
			b_offset += ruleEntrySize;
		}	
		
		Y[p] = s;
		
		point_offset += pointDimension;	
	}
		
	return this;
}

UnormAnfis.prototype.useKnownOutput = function(outputDataArray)
{
        // argument array length must be consistent with current tab points count
        
	this.currentKnownOutput = outputDataArray;
	
	return this;
}

UnormAnfis.prototype.evaluateError = function()
{			
	var e = 0;
	
	var count = this.currentTabPointsCount;
	
	var y1 = this.currentKnownOutput;
	var y2 = this.currentTabOutput;
	
	for(var i = 0; i < count; ++i)
	{		
		var d = y2[i] - y1[i];
		
		e += d * d; 		
	}
	
	this.currentError = e;
	
	return this;
}
    
////////////////// end of Unorm ANFIS model stuff

//-----------------------------------------------------------------------------

function isProperFootprint(footprint)
{
    return (footprint === 'trained');
}

//-----------------------------------------------------------------------------

function processingBody(model, testCollection, callbackOnDone)
{
    const decimalPlaces = 6;

    // srcContent is model
    // {footprint: 'trained', rulesCount: anfisRulesCount, rangesMin: [], rangesMax: [], trainSet: [/*normalized*/], parameters: [], optimizedParameters: []};
    
    var testPointsCount = testCollection.length;
    var fieldsCount = testCollection[0].length;
    var tabFieldsCount = fieldsCount - 1;
    
    var tabPoints = new Float64Array(testPointsCount * tabFieldsCount);
    var knownOutput = new Float64Array(testPointsCount);
 
    // we need to normalize test points using embedded ranges for every item
 
    var ranges = [];
    
    for(var i = 0; i < tabFieldsCount; ++i)
    {
        ranges[i] = model.rangesMax[i] - model.rangesMin[i];
    }
    
        // split test set to tab points and known output
    
    var records0 = 0;
    var records1 = 0;
    
    var tabIndex = 0;
    
    for(var row = 0; row < testPointsCount; ++row)
    {
        var record = testCollection[row];
        
        for(var col = 0; col < fieldsCount; ++col)
        {
            if(col < tabFieldsCount)
            {
                var v = record[col];
                
                if(ranges[col] === 0)
                {
                    // we must use ranges from test set! to do;
                    v = 0;
                }
                else
                {
                    v = (v - model.rangesMin[col]) / ranges[col];
                }
                
                tabPoints[tabIndex] = v;
                ++tabIndex;
            }
            else
            {
                var v = record[col];
                knownOutput[row] = (v > 0) ? 2 : -2;
                
                // to do: if snobby, move it to collection retrieval phase
                
                if(v === 0){++records0;}else{++records1;}
            }
        }
    }
    
        // apply anfis to (test) tab points
    
    var anfis = new UnormAnfis(tabFieldsCount, model.rulesCount);
    
    anfis.useParameters(model.optimizedParameters);
    anfis.useTabPoints(tabPoints);
    anfis.useKnownOutput(knownOutput);
    anfis.evauateTabPoints();
    anfis.evaluateError();
    
    var rawError = decimalRound(anfis.currentError, decimalPlaces);
    
    var err0 = 0;
    var err1 = 0;

    for(var i = 0; i < testPointsCount; ++i)
    {
        var ko = knownOutput[i];
        
        ko = (ko < model.separator) ? 0 : 1;
        
        var to = anfis.currentTabOutput[i];
        
        to = (to < model.separator) ? 0 : 1;

        if(ko === 0)
        {
            if(to !== 0)
            {
                ++err0;
            }
        }
        else if(to !== 1)
        {
            ++err1;
        }
    }
    
    model.classifierError = decimalRound((err0 + err1) / testPointsCount, decimalPlaces);

    logInfo('Tested raw error: ' + 
        rawError + ', classifier errors: err0: ' + err0 + ', err1: ' + err1 + ', separator: ' + model.separator +
        ' [' + 100 * model.classifierError + '%];' +
        ' tested on ' + testPointsCount + 
            ' points, ' + records0 +' 0s and ' + records1 + ' 1s');
    
    model.footprint = 'tested';
    
    callbackOnDone(model);
}

//-----------------------------------------------------------------------------

$(document).ready(function(){
    
        // time needed to do processing of one item in normal conditions, sec
        
    const keyExpirationTime = 40;
    
        // setup Watchdog stuff
    /*
    var watchDogEntry = new WatchDog(15000, function(watchdog){
        
        logInfo('Watchdog ' + watchdog.timeoutId + ' timeout (' + watchdog.timeout + ' msec)');    
    });
    */
        //
        
    var token = 'int_train-test';
    
    const dbname = 'int_test';    
    
    var yadb = new Yadb(dbname);
    
        //
    function reportErrorAndStop(phases, phaseEntryIndex)
    {
        var entry = phases[phaseEntryIndex];
        
        logInfo('Error processing items for token ' + entry.args.token + '; stopped.');   
        
        // no need killing watchdog, just change script
    }
    
    function retrieveFullCollection(phases, phaseEntryIndex)
    {
        var entry = phases[phaseEntryIndex];
        
        var yadb = entry.args.yadb;
        
        logInfo('Retrieving test data');
        
        yadb.retrieveFullCollection(function(response){
            
            if(response.reply)
            {
                logInfo('Full retrieved; length = ' + response.reply.length);    
                
                var nextPhaseEntryIndex = phaseEntryIndex + 1;
                
                phases[nextPhaseEntryIndex].args.collection = response.reply;
                phases[nextPhaseEntryIndex].proc(phases, nextPhaseEntryIndex);
            }
            else
            {
                // to do: change this behaviour to 'try again'
                
                //logInfo(response.error);
                //phases[phaseStopOnError].proc(phases, phaseStopOnError);
                phases[phaseEntryIndex].proc(phases, phaseEntryIndex);
            }
            
        }, function(chunksDone, chunksCount, chunkResponded){
            
            logInfo('[' + chunkResponded + ']. Done ' + chunksDone + ' of ' + chunksCount);    
        });  
    }
    
    function prepareCollectionData(phases, phaseEntryIndex)
    {
        var entry = phases[phaseEntryIndex];    
        
        var collection = entry.args.collection;
        var recordsCount = collection.length;
        
        var records = [];
        
            // parse strings
        
        for(var i = 0; i < recordsCount; ++i)
        {
            var s = '[' + collection[i] + ']';
            var rec = JSON.parse(s);
            records.push(rec);
        }
        
        logInfo('Parsed ' + records.length +' test records');

        phases[phaseProcessing].args.collection = records;

        var nextPhaseEntryIndex = phaseEntryIndex + 1;
        phases[nextPhaseEntryIndex].proc(phases, nextPhaseEntryIndex);
    }
    
    function createRegistry(srcCollection, destRegistry)
    {
        var count = srcCollection.length;
        
        for(var i = 0; i < count; ++i)
        {
            destRegistry[srcCollection[i].name] = true;
        }
    }
    
    function getList(phases, phaseEntryIndex)
    {
        var entry = phases[phaseEntryIndex];
        
        var inFolder = entry.args.inFolder;
        var registry = entry.args.registry;
        
        logInfo('Reading folder ' + inFolder);
           
        redisPostCommand('YAD_LIST_ELEMENTS', [inFolder], function(response){
            
            if(response.error)
            {
                logInfo(JSON.stringify(response.error));
                phases[phaseStopOnError].proc(phases, phaseStopOnError);
            }
            else if(response.reply && response.reply.error)
            {
                logInfo(JSON.stringify(response.reply));
                phases[phaseStopOnError].proc(phases, phaseStopOnError);
            }
            else
            {
                var itemsCollection = response.reply._embedded.items;
                
                createRegistry(itemsCollection, registry);

                phases[phaseEntryIndex + 1].proc(phases, phaseEntryIndex + 1);
            }
        }, function(xhr, st, er){
            
            logInfo(er);
            phases[phaseStopOnError].proc(phases, phaseStopOnError);
        });        
    }

    function createPotentialWorkset(phases, phaseEntryIndex)
    {
        var entry = phases[phaseEntryIndex];
        
        var srcItems = entry.args.src;
        var resItems = entry.args.res;
        
        var checklist = [];
        
        var srcNamesList = Object.keys(srcItems);
        var srcCount = srcNamesList.length;
        
        for(var i = 0; i < srcCount; ++i)
        {
            var name = srcNamesList[i];
            
            if(resItems[name] === undefined)
            {
                checklist.push(name);
            }
        }

        if(checklist.length === 0)
        {
            logInfo('No more unprocessed items for token ' + entry.args.token + '; stopped.');     
            
            // no need killing watchdog, just change script
        }
        else
        {
            var nextPhaseEntryIndex = phaseEntryIndex + 1;
            
            phases[nextPhaseEntryIndex].args.checklist = checklist;
            
            phases[nextPhaseEntryIndex].proc(phases, nextPhaseEntryIndex);
        }
    }

    function dropOldItemNames(phases)
    {
            // clear old lists of sources and results
            
        phases[phasePotentialWorksetBulding].args.src = phases[phaseSourcesListing].args.registry = {};     
        phases[phasePotentialWorksetBulding].args.res = phases[phaseResultsListing].args.registry = {};    
    }

    function randomSelection(phases, phaseEntryIndex)
    {
        var entry = phases[phaseEntryIndex];
        
        var checklist = entry.args.checklist;
        var checkCount = checklist.length;

        if(checkCount === 0)
        {
            // we exhausted checklist (all items we have checked are locked by other threads), change script - or just wait a bit   
            
            logInfo('No more accessible items for token ' + entry.args.token + ' for now; waiting...');
            
            // watchdog restart!
            
            dropOldItemNames(phases);

            setTimeout(function(){
                
                phases[phaseSourcesListing].proc(phases, phaseSourcesListing);
                
            }, Math.floor(Math.random() * keyExpirationTime * 1000));
            
        }
        else
        {
                // generate random number in [0, current checklist length)  
                //  and go to check Redis key stuff
                
            var nextPhaseEntryIndex = phaseEntryIndex + 1;

            phases[nextPhaseEntryIndex].args.randomIndex = Math.floor(Math.random() * checkCount);

            phases[nextPhaseEntryIndex].args.checklist = checklist;

            phases[nextPhaseEntryIndex].proc(phases, nextPhaseEntryIndex);
        }
    }

    function checkAtomic(phases, phaseEntryIndex)
    {
        var entry = phases[phaseEntryIndex];
        
        var randomIndex = entry.args.randomIndex;
        var checklist = entry.args.checklist;
        
        var name = checklist[randomIndex];
        var key = entry.args.token + ':' + name;

            // (potential) revision phase will use checklist and randomIndex
        phases[phaseRevision].args.checklist = checklist;    
        phases[phaseRevision].args.randomIndex = randomIndex;
            
            // check Redis key for this entry by Atomically INCrementing 'token:item_name'
            // (also sets key EXpiration time)

        redisPostCommand('aincex', [key, keyExpirationTime], function(response){

            var nextPhaseEntryIndex;
            
            if(response && response.reply && (response.reply === 1))
            {
                    // we are first who touched this item in competition!
                
                nextPhaseEntryIndex = phaseProcessing;
                
                    // processing phase will use item name
                    
                phases[phaseProcessing].args.name = name;
            }
            else
            {
                nextPhaseEntryIndex = phaseRevision;
            }

            phases[nextPhaseEntryIndex].proc(phases, nextPhaseEntryIndex);
            
        }, function(){
            
                // if network transfer error occurs, it's better skip this entry
                //      (goes to revision of checklist)
            phases[phaseRevision].proc(phases, phaseRevision);
        });
    }

    function processItem(phases, phaseEntryIndex)
    {
        var entry = phases[phaseEntryIndex];
        
        var name = entry.args.name;
        
        dropOldItemNames(phases);
        
        logInfo('Reading item ' + name);
        
        redisPostCommand('YAD_READ_ITEM', [entry.args.srcFolder, name], function(response){
            
            if(response && response.reply)
            {
                if(!isProperFootprint(response.reply.footprint))
                {
                    // do not process this item
                    
                    logInfo('Skipping improper footprinted item ' + name);
                    
                    phases[phaseRevision].proc(phases, phaseRevision);
                }
                else
                {
                    logInfo('Processing item ' + name);
                    
                        // process item (async for heavy load) and go to write result phase
                    
                    processingBody(response.reply, entry.args.collection, function(modelObject){
                        
                        //logInfo('Stopped');
                        
                        //*
                        var nextPhaseEntryIndex = phaseWriteResult;
                        
                        phases[nextPhaseEntryIndex].args.resultContent = modelObject;
                        
                        phases[nextPhaseEntryIndex].args.name = name;
                        
                        phases[nextPhaseEntryIndex].proc(phases, nextPhaseEntryIndex);
                        //*/
                    });
                }
            }
            else
            {
                    // on error it is better to skip this item
                phases[phaseRevision].proc(phases, phaseRevision);
            }
            
        }, function(){
            
                // on error it is better to skip this item
            phases[phaseRevision].proc(phases, phaseRevision);
        });        
    }

    function writeResult(phase, phaseEntryIndex)
    {
        var entry = phases[phaseEntryIndex];
        
        logInfo('Writing result ' + entry.args.name);
        
        // even if any problem occured, we have nothing to do with it - go to next cycle
        
        redisPostCommand('YAD_CREATE_ITEM', [entry.args.resFolder, entry.args.name, entry.args.resultContent], function(response){
            
            // watchdog restart!
            
            phases[phaseSourcesListing].proc(phases, phaseSourcesListing);
            
        }, function(){
            
            // watchdog restart!
            
            phases[phaseSourcesListing].proc(phases, phaseSourcesListing);
        }); 
    }

    function reviseItem(phases, phaseEntryIndex)
    {
        var entry = phases[phaseEntryIndex];
        
        var randomIndex = entry.args.randomIndex;
        
        var checklist = entry.args.checklist;
        var count = checklist.length;
        
        var newList = [];
        
        for(var i = 0; i < count; ++i)
        {
            if(i !== randomIndex)
            {
                newList.push(checklist[i]);    
            }
        }
        
        phases[phaseRandomSelection].args.checklist = newList;
        
        phases[phaseRandomSelection].proc(phases, phaseRandomSelection);
    }

        //
        
    var srcFolder = 'workspace/' + token + '/sources';
    var resFolder = 'workspace/' + token + '/results';
    
    var sourceItems = {};
    var resultItems = {};
    
    const phaseSourcesListing = 2;
    const phaseResultsListing = 3;
    const phasePotentialWorksetBulding = 4;
    const phaseRandomSelection = 5;
    const phaseProcessing = 7;
    const phaseRevision = 8;
    const phaseWriteResult = 9;
    const phaseStopOnError = 10;
    
    var phases = 
    [
    /*0*/   {proc: retrieveFullCollection, args: {yadb: yadb}},   
    /*1*/   {proc: prepareCollectionData, args: {}},   
    /*2*/   {proc: getList, args: {inFolder: srcFolder, registry: sourceItems}},
    /*3*/   {proc: getList, args: {inFolder: resFolder, registry: resultItems}},
    /*4*/   {proc: createPotentialWorkset, args: {src: sourceItems, res: resultItems, token: token}},
    /*5*/   {proc: randomSelection, args: {token: token}},
    /*6*/   {proc: checkAtomic, args: {token: token}},
    /*7*/   {proc: processItem, args: {srcFolder: srcFolder}},
    /*8*/   {proc: reviseItem, args: {}},
    /*9*/   {proc: writeResult, args: {resFolder: resFolder}},
    /*10*/  {proc: reportErrorAndStop, args: {token: token}}
    ];
    
    phases[0].proc(phases, 0);
    
});

//-----------------------------------------------------------------------------

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

UnormAnfis.prototype.evaluateTabPoints = function()
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
    return (footprint === 'tested');
}

//-----------------------------------------------------------------------------

function processingBody(itemsContent, testCollection, callbackOnDone)
{
    const decimalPlaces = 6;

    var testPointsCount = testCollection.length;
    var fieldsCount = testCollection[0].length;
    var tabFieldsCount = fieldsCount - 1;

    // {footprint: 'tested', rulesCount: anfisRulesCount, separator:, amplitude:, rangesMin: [], rangesMax: [], trainSet: [/*normalized*/], parameters: [], optimizedParameters: []};
    
    var itemNames = Object.keys(itemsContent);
    var itemsCount = itemNames.length;
    
    var ensemble = 
    {
        items: []
    };
    
    var ensembleOutput = new Float64Array(testPointsCount);
        
    for(var i = 0; i < itemsCount; ++i)
    {
        var model = itemsContent[itemNames[i]];

        ensemble.items.push({
            rulesCount: model.rulesCount,
            rangesMin: model.rangesMin,
            rangesMax: model.rangesMax,
            optimizedParameters: model.optimizedParameters,
            classifierError: model.classifierError
        });
        
        // we need to normalize test points using embedded ranges for every item
     
        var ranges = [];
        
        for(var j = 0; j < tabFieldsCount; ++j)
        {
            ranges[j] = model.rangesMax[j] - model.rangesMin[j];
        }
        
            // extract tab points from test set
            
        var tabPoints = new Float64Array(testPointsCount * tabFieldsCount);
        
        var tabIndex = 0;
        
        for(var row = 0; row < testPointsCount; ++row)
        {
            var record = testCollection[row];
            
            for(var col = 0; col < tabFieldsCount; ++col)
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
        }
        
            // apply anfis to (test) tab points
            
        var anfis = new UnormAnfis(tabFieldsCount, model.rulesCount);
        
        anfis.useParameters(model.optimizedParameters);
        anfis.useTabPoints(tabPoints);
        anfis.evaluateTabPoints();
        
        var output = anfis.currentTabOutput;
        
        for(var j = 0; j < testPointsCount; ++j)
        {
            ensembleOutput[j] += output[j];
        }
    }
        // now test ensemble
    
        // to do: how we may use items separators and amplitudes?
    const separator = 0;
    ensemble.separator = separator;
    
    var records0 = 0;
    var records1 = 0;
    
    var err0 = 0;
    var err1 = 0;
    
    var yIndex = tabFieldsCount;
    
    for(var row = 0; row < testPointsCount; ++row)
    {
        var ko = testCollection[row][yIndex];
        
        if(ko === 0){++records0;}else{++records1;}
        
        var eo = ensembleOutput[row];
        
        eo = (eo > separator) ? 1 : 0;
        
        if(ko === 0)
        {
            if(eo !== 0)
            {
                ++err0;
            }
        }
        else if(eo !== 1)
        {
            ++err1;
        }
    }
    
    
    ensemble.classifierError = decimalRound((err0 + err1) / testPointsCount, decimalPlaces);

    logInfo('Tested classifier errors: err0: ' + err0 + ', err1: ' + err1 + ', separator: ' + separator +
        ' [' + 100 * ensemble.classifierError + '%];' +
        ' tested on ' + testPointsCount + 
            ' points, ' + records0 +' 0s and ' + records1 + ' 1s');

    callbackOnDone(ensemble);
}

//-----------------------------------------------------------------------------

$(document).ready(function(){
    
    // retrieve test collection
    // get items list for source folder
    // select several names randomly
    // load all models
    // when all loaded, get test
    
        // setup Watchdog stuff
    /*
    var watchDogEntry = new WatchDog(15000, function(watchdog){
        
        logInfo('Watchdog ' + watchdog.timeoutId + ' timeout (' + watchdog.timeout + ' msec)');    
    });
    */
        //
        
    var token = 'int_train-ensembles';
    
    const dbname = 'int_test';    
    
    var yadb = new Yadb(dbname);
    
    const ensembleSize = 5;
    
    const waitTime = 2000; // ms
        
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

        phases[phaseEnsembleTesting].args.collection = records;

        var nextPhaseEntryIndex = phaseEntryIndex + 1;
        phases[nextPhaseEntryIndex].proc(phases, nextPhaseEntryIndex);
    }

    function getList(phases, phaseEntryIndex)
    {
        var entry = phases[phaseEntryIndex];
        
        var inFolder = entry.args.inFolder;

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
                var itemsCount = response.reply._embedded.items.length;
                
                logInfo(itemsCount + ' item(s) present in folder ' + inFolder);
                
                if(itemsCount < ensembleSize)
                {
                    logInfo('No enough items to compose ensemble of ' + ensembleSize + ' models; waiting...');
                    
                    setTimeout(function(){
                        
                        phases[phaseEntryIndex].proc(phases, phaseEntryIndex);
                        
                    }, waitTime);
                    
                        // or may change script
                }
                else
                {
                    logInfo('Enough items to build ensemble');
                    
                    var yadList = response.reply._embedded.items;

                    var itemsCollection = [];
                    
                    for(var i = 0; i < itemsCount; ++i)
                    {
                        itemsCollection.push(yadList[i].name);
                    }
                    
                    var nextPhaseEntryIndex = phaseEntryIndex + 1;
                    
                    phases[nextPhaseEntryIndex].args.itemsCollection = itemsCollection;
    
                    phases[nextPhaseEntryIndex].proc(phases, nextPhaseEntryIndex);
                }
            }
        }, function(xhr, st, er){
            
            logInfo(er);
            phases[phaseStopOnError].proc(phases, phaseStopOnError);
        });        
    }
    
    function checkAllDone(itemsResponded, itemsCount, callbackOnAllRetrieved)
    {
        var itemsContentCount = Object.keys(itemsResponded).length;
        
        if(itemsContentCount === itemsCount)
        {
            callbackOnAllRetrieved(null, itemsResponded);
        }
        else
        {
            callbackOnAllRetrieved('Error retrieving items', null);
        }
    }
    
    function retrieveAll(selectedItemsRegistry, inFolder, callbackOnAllRetrieved)
    {
        var itemsList = Object.keys(selectedItemsRegistry);
        var itemsCount = itemsList.length;
        
        logInfo('Issue items reading');
        
        var items = {};
        
        var respondsCount = 0;
        
        for(var i = 0; i < itemsCount; ++i)
        {
            redisPostCommand('YAD_READ_ITEM', [inFolder, itemsList[i]], function(response){
                
                ++respondsCount;
                
                var name = itemsList[this.itemIndex];
                
                if(response.reply)
                {
                    if(!isProperFootprint(response.reply.footprint))
                    {
                        // do not use this untested item
                        
                        logInfo('Skipping improper footprinted item ' + name);
                    }
                    else
                    {
                        logInfo(name + ' retrieved');
                        
                        items[name] = response.reply;
                    }
                }
                
                if(respondsCount === itemsCount)
                {
                    checkAllDone(items, itemsCount, callbackOnAllRetrieved);    
                }

            }.bind({itemIndex: i}), function(xhr, st, er){
                
                ++respondsCount;
                
                if(respondsCount === itemsCount)
                {
                    checkAllDone(items, itemsCount, callbackOnAllRetrieved);    
                }
            });
        }
    }
    
    function loadSelectedItems(phases, phaseEntryIndex)
    {
        var entry = phases[phaseEntryIndex];
        
        var inFolder = entry.args.inFolder;
        
        var itemsCollection = entry.args.itemsCollection;
        var itemsCount = itemsCollection.length;

        var selectedItems = {};
        
        var s = '';
        
        for(var i = 0; i < ensembleSize; ++i)
        {
            do
            {
                var randomIndex = Math.floor(Math.random() * itemsCount);
                
                var itemName = itemsCollection[randomIndex];
            }
            while(selectedItems[itemName] !== undefined);
            
            selectedItems[itemName] = true;
            
            s += itemName + ', ';
        }
        
        logInfo('Selected items: ' + s);
        
        retrieveAll(selectedItems, inFolder, function(err, data){
            
            if(err)
            {
                logInfo(err + '; try again...');

                setTimeout(function(){
                    
                    phases[phaseEntryIndex].proc(phases, phaseEntryIndex);
                    
                }, waitTime);
                
                    // or may change script
            }
            else
            {
                logInfo('All items retrieved');
                
                var nextPhaseEntryIndex = phaseEntryIndex + 1;
                
                phases[nextPhaseEntryIndex].args.itemsContent = data;

                phases[nextPhaseEntryIndex].proc(phases, nextPhaseEntryIndex);
            }
        });
    }
    
    function testEnsemble(phases, phaseEntryIndex)
    {
        var entry = phases[phaseEntryIndex];
        
        processingBody(entry.args.itemsContent, entry.args.collection, function(ensemble){
            
            if(ensemble)
            {
                logInfo('Ensemble construction done');
                
                var nextPhaseEntryIndex = phaseEntryIndex + 1;
                
                phases[nextPhaseEntryIndex].args.ensembleContent = ensemble;
    
                phases[nextPhaseEntryIndex].proc(phases, nextPhaseEntryIndex);
            }
            else
            {
                logInfo('Ensemble construction failed');
                
                // watchdog restart!
                
                phases[phaseFolderListing].proc(phases, phaseFolderListing);
            }
        });
    }
    
    function writeResult(phase, phaseEntryIndex)
    {
        var entry = phases[phaseEntryIndex];
        
        var name = generateUniqueKey() + '.json';
        
        logInfo('Writing ensemble ' + name);
        
        // even if any problem occured, we have nothing to do with it - go to next cycle
        
        redisPostCommand('YAD_CREATE_ITEM', [entry.args.resFolder, name, entry.args.ensembleContent], function(response){
            
            logInfo('Stopped');
            
            // watchdog restart!
            
            //phases[phaseFolderListing].proc(phases, phaseFolderListing);
            
        }, function(){
            
            logInfo('Stopped');
            
            // watchdog restart!
            
            //phases[phaseFolderListing].proc(phases, phaseFolderListing);
        }); 
    }
    
        //
        
    var srcFolder = 'workspace/' + token + '/sources';
    var resFolder = 'workspace/' + token + '/results';
    
    const phaseFolderListing = 2;
    const phaseEnsembleTesting = 4;
    const phaseStopOnError = 6;
    
    var phases = 
    [
    /*0*/   {proc: retrieveFullCollection, args: {yadb: yadb}},   
    /*1*/   {proc: prepareCollectionData, args: {}},   
    /*2*/   {proc: getList, args: {inFolder: srcFolder}},
    /*3*/   {proc: loadSelectedItems, args: {inFolder: srcFolder}},
    /*4*/   {proc: testEnsemble, args: {}},
    /*5*/   {proc: writeResult, args: {resFolder: resFolder}},
    /*6*/   {proc: reportErrorAndStop, args: {token: token}}
    ];
    
    phases[0].proc(phases, 0);
});

//-----------------------------------------------------------------------------

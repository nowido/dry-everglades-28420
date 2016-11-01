//-----------------------------------------------------------------------------

    // Processor unit, PU;
    //  reads workspace/token/sources and workspace/token/results,
    //  selects source item wich has no corresponding result, 
    //  processes it (with atomic stuff)
    //  writes result block to results,
    //  restarts reading workspace folders, and so on

// TO DO this is not ANFIS LBFGS training implementation yet; work in progress

//-----------------------------------------------------------------------------

function logInfo(info)
{
    $('<p>' + info + '</p>').appendTo(document.body);
}

//-----------------------------------------------------------------------------

function workerEntry()
{
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
            this.needRecreateTemps = true;    
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
    
    UnormAnfis.prototype.evaluateErrfGrad = function(errfGrad)
    {
    	// this method is used only in optimization (training) procedures 
    	
    	// argument is plain array of entries corresponding to ANFIS parameters
    	//  (its length is rulesCount * ruleEntrySize)
    		
    	var pointsCount = this.currentTabPointsCount;	
    	var rulesCount = this.rulesCount;
    	var ruleEntrySize = this.ruleEntrySize;
    	var pointDimension = this.pointDimension;
    	var modelParameters = this.modelParameters;
    	
    	var X = this.currentTabPoints;
    	var Y = this.currentKnownOutput;
        
    	if(this.needRecreateTemps)
    	{
    		this.products = new Float64Array(pointsCount * rulesCount);
    		this.linears = new Float64Array(this.products.length);
    		this.errs =  new Float64Array(pointsCount);
    				
    		this.needRecreateTemps = false;
    	}
        
    	var products = this.products;
    	var linears = this.linears;	
    	var errs = this.errs;	
    		
    	var currentError = 0;
        
            // evaluate temps first,
            // dispatch for [points count x rules count],
            // if 2d layout, rows are for points, cols are for rules
        	
    	var point_offset = 0;
    	
    	var point_rule_offset = 0;
    
    	var q_offset;
    	var k_offset;
    	var b_offset;
    	
    	for(var i = 0; i < pointsCount; ++i)
    	{			
    		var s = 0;		
    				
    		var rule_offset = 0; 
    		
    		q_offset = pointDimension;
    		k_offset = 2 * pointDimension;
    		b_offset = 3 * pointDimension;
    	
    		for(var r = 0; r < rulesCount; ++r)
    		{			
    			var muProduct = 0;
    			
    			var L = modelParameters[b_offset];
    
    			for(var m = 0; m < pointDimension; ++m)
    			{
    				var arg = X[point_offset + m];
    
    				var a = modelParameters[rule_offset + m];
    				var q = modelParameters[q_offset + m];
    				
    				var t = (arg - a) / q;
    								
    				muProduct -= t * t;
    				
    				L += arg * modelParameters[k_offset + m];								
    			}	
    						
    			muProduct = Math.exp(muProduct);
    			
    			products[point_rule_offset] = muProduct; 
    			linears[point_rule_offset] = L;
    			
    			s += muProduct * L;
    			
    			rule_offset += ruleEntrySize;
    			
    			q_offset += ruleEntrySize;
    			k_offset += ruleEntrySize;
    			b_offset += ruleEntrySize;	
    			
    			++point_rule_offset;		
    		}
    	
    		var d = s - Y[i];
    		
    		errs[i] = d;		
    		currentError += d * d; 
    		
    		point_offset += pointDimension;			
    	}
    	
    	this.currentError = currentError;
        
            // having temps done, evaluate errf grad,
            // dispatch for [rules count x point dimension] 
            // if 2d layout, rows are for rules, cols are for points
    	
    	rule_offset = 0;
    	
    	q_offset = pointDimension;
    	k_offset = 2 * pointDimension;
    	b_offset = 3 * pointDimension;
    	
    	for(var r = 0; r < rulesCount; ++r)
    	{
    			// rule entry {{a, q, k}, b}
    
    			// br		
    		var sBr = 0;
    
    			// arm, qrm, krm
    		for(var m = 0; m < pointDimension; ++m)
    		{
    			var sArm = 0;
    			var sQrm = 0;
    			var sKrm = 0;
    			
    			var sFactorArm;
    			var sFactorQrm;
    			
    			var arm = modelParameters[rule_offset + m];
    			var qrm = modelParameters[q_offset + m];
    				
    			sFactorArm = 4 / (qrm * qrm);
    			sFactorQrm = sFactorArm / qrm; 				
    
    			point_offset = 0;
    			point_rule_offset = r;
    			
    			for(var i = 0; i < pointsCount; ++i)
    			{
    				var xm = X[point_offset + m];
    				
    				var t2 = xm - arm;
    				var t3 = products[point_rule_offset] * errs[i];
    				
    				var t6 = t2 * t3 * linears[point_rule_offset]; 
    				
    				sArm += t6; 
    				sQrm += t2 * t6;
    				
    				sKrm += xm * t3;
    				
    				if(m === 0)
    				{
    					sBr += t3;	
    				}				
    									
    				point_offset += pointDimension;
    				point_rule_offset += rulesCount;
    			}																			 	
    			
    			errfGrad[rule_offset + m] = sFactorArm * sArm;
    			errfGrad[q_offset + m] = sFactorQrm * sQrm;	
    			errfGrad[k_offset + m] = 2 * sKrm;
    		}
    							
    		errfGrad[b_offset] = 2 * sBr;
    		
    		rule_offset += ruleEntrySize;
    		
    		q_offset += ruleEntrySize;
    		k_offset += ruleEntrySize;
    		b_offset += ruleEntrySize;		
    	}
    		
    	return this;	
    }
    
    ////////////////// end of Unorm ANFIS model stuff
    
    ////////////////// LBFGS stuff
    
    // to do load history
    
    function AntigradientLbfgs(problemDimension, historySize)
    {	
    	this.problemDimension = problemDimension;
    	this.historySize = (historySize !== undefined) ? historySize : 10;
        
    		// ping-pong indices 
    	this.ppCurrent = 0;
    	this.ppNext = 1;
    	
    		// history entries
    	this.historyS = [];
    	this.historyY = [];
    	
    	this.historyA = [];
    			
    	this.historyInnerProductsSY = [];
    		
    	for(var i = 0; i < this.historySize; ++i)
    	{
    		this.historyS[i] = new Float64Array(problemDimension);
    		this.historyY[i] = new Float64Array(problemDimension);						
    	}
    		
    		// argument
    	this.X = [];
    	
    	this.X[this.ppNext] = new Float64Array(problemDimension);
    		
    		// goal function value
    	this.f = [];	
    			
    		// gradient
    	this.Grad = [];
    
    	this.Grad[this.ppCurrent] = new Float64Array(problemDimension);
    	this.Grad[this.ppNext] = new Float64Array(problemDimension);
    		
    		//
    	this.p = new Float64Array(problemDimension);
    		
    		//
    	this.epsilon = 0.001;
    	
    		//
    	this.firstStep = true;
    }
    
    AntigradientLbfgs.prototype.useGradientProvider = function(fillGradient)
    {
    	// fillGradient(vectorX, gradArray), returns f_X
    	
    	this.gradF = fillGradient;
    	
    	return this; 
    }
    
    AntigradientLbfgs.prototype.useInitialArgument = function(initialArray)
    {	
    	this.X[this.ppCurrent] = initialArray;
    			
    	return this;
    }
    
    AntigradientLbfgs.prototype.useEpsilon = function(someSmallEpsilon)
    {
    	this.epsilon = someSmallEpsilon;
    	
    	return this;
    }
    
    AntigradientLbfgs.prototype.innerProduct = function(v1, v2)
    {
    	// returns v1 * v2, inner product, scalar
    	
    	var s = 0;
    
    	var problemDimension = this.problemDimension;
    		
    	for(var i = 0; i < problemDimension; ++i)
    	{
    		s += v1[i] * v2[i];		
    	}	
    	
    	return s;
    }
    
    AntigradientLbfgs.prototype.linearVectorExpression = function(v0, scalar, v1, result)
    {
    	// result = v0 + scalar * v1;
    
    	var problemDimension = this.problemDimension;
    		
    	for(var i = 0; i < problemDimension; ++i)
    	{
    		result[i] = v0[i] + scalar * v1[i];		
    	}	
    	
    	return result;
    } 
    
    AntigradientLbfgs.prototype.scaleVector = function(scalar, v, result)
    {
    	// result = scalar * v;
    
    	var problemDimension = this.problemDimension;
    		
    	for(var i = 0; i < problemDimension; ++i)
    	{
    		result[i] = scalar * v[i];		
    	}	
    	
    	return result;
    } 
    
    AntigradientLbfgs.prototype.vectorDifference = function(v1, v2, result)
    {
    	// result = v1 - v2;
    
    	var problemDimension = this.problemDimension;
    		
    	for(var i = 0; i < problemDimension; ++i)
    	{
    		result[i] = v1[i] - v2[i];		
    	}	
    	
    	return result;
    } 
    
    AntigradientLbfgs.prototype.reset = function()
    {
    	this.firstStep = true;
    	
    	this.diverged = false;
    	this.local = false;
    	this.weird = false;
    	
    	return this;
    }
    
    AntigradientLbfgs.prototype.linearSearch = function(maxSteps)
    {
            // Nocedal, Wright, Numerical Optimization, p. 61
            
    	const c1 = 0.0001;
    	const c2 = 0.9;
    	
    	const alphaGrowFactor = 3;
    	
    	var alpha = 1;
    	var alphaLatch = alpha;
    	
    	var steps = 0;
    	
    	var mustReturn = false;
    	
    	var previousStepWasGood = false;
    	
    	var wolfeOk;
    	
    	var fCurrent = this.f[this.ppCurrent];
    	var fNext;
    	var fMin = fCurrent;
    	
    	for(;;)
    	{	
    		this.linearVectorExpression
    		(
    			this.X[this.ppCurrent], 
    			alpha, 
    			this.p, 
    			this.X[this.ppNext]
    		);
    		
    		fNext = this.f[this.ppNext] = this.gradF
    		(
    			this.X[this.ppNext],
    			this.Grad[this.ppNext]
    		);
    		
    		if(mustReturn)
    		{
    			break;
    		}
    		
    		var wolfeTmpProduct = this.innerProduct
    		(
    			this.p, 
    			this.Grad[this.ppCurrent]
    		);
    		
    		var absWolfeTmpProduct = Math.abs(wolfeTmpProduct);
    						
    		var wolfe1 = (fNext <= (fCurrent + c1 * alpha * wolfeTmpProduct));  
    		
    		var absWolfeTmpProductNext = Math.abs
    		(
    			this.innerProduct(this.p, this.Grad[this.ppNext])
    		);
    			
    		var wolfe2 = (absWolfeTmpProductNext <= c2 * absWolfeTmpProduct);
    		
    		wolfeOk = wolfe1 && wolfe2;			
    		
    		++steps;
    
    		if(steps >= maxSteps)
    		{
    			if(wolfeOk)
    			{
    				break;
    			}
    			else
    			{
    				mustReturn = true;
    				
    					// no more steps, just restore good alpha;
    					// cycle will break after grad evaluation
    					
    				if(previousStepWasGood)
    				{
    					alpha = alphaLatch;	
    				}	
    			}										
    		}				
    		else
    		{
    			var alphaFactor = alphaGrowFactor + (-1 + 2 * Math.random());
    			
    			if(wolfeOk)
    			{
    					// store good alpha ...
    				alphaLatch = alpha;
    				
    					// ... and try greater alpha value
    				alpha *= alphaFactor;	
    				
    				previousStepWasGood = true;									
    			}
    			else if(!previousStepWasGood)
    			{
    					// use smaller value
    				alpha /= alphaFactor;										
    			}
    			else
    			{
    				mustReturn = true;
    				
    					// f value gone bad, just restore good alpha;
    					// cycle will break after grad evaluation
    				alpha = alphaLatch;	
    				
    				wolfeOk = true;										
    			}						
    		}			
    					
    	} // end for(;;)
    	
    	return wolfeOk;
    }
    
    AntigradientLbfgs.prototype.makeInitialSteps = function(stepsToReport, linearSearchStepsCount)
    {
    	var dimension = this.problemDimension;
    
    	var m = this.historySize;
    	var newestEntryIdex = m - 1;
    	
    	// fill history entries
    	
    	if(this.firstStep)
    	{
    		this.f[this.ppCurrent] = this.gradF
    		(
    			this.X[this.ppCurrent],
    			this.Grad[this.ppCurrent]			
    		);	
    		
    		this.firstStep = false;
    	}

    	for(var i = 0; i < m; ++i)
    	{
    		for(var j = 0; j < dimension; ++j)
    		{
    			this.p[j] = -this.Grad[this.ppCurrent][j];
    		}
    
    		this.linearSearch(linearSearchStepsCount);	

    		if(isNaN(this.f[this.ppNext]))
    		{
    			this.weird = true;
    		}
    		
    		if(this.f[this.ppCurrent] < this.f[this.ppNext])
    		{
    			this.diverged = true;
    		}
    		
    		if(this.weird || this.diverged)
    		{
    				// reset model to good point
    			this.gradF
    			(
    				this.X[this.ppCurrent],
    				this.Grad[this.ppCurrent]			
    			);		
    			
    			break;
    		}		
    
    		if(Math.abs(this.f[this.ppCurrent] - this.f[this.ppNext]) < this.epsilon)
    		{
    			this.local = true;
    			break;
    		}		
    
    			//
    		this.vectorDifference
    		(
    			this.X[this.ppNext], 
    			this.X[this.ppCurrent], 
    			this.historyS[i]
    		);			 
    
    		this.vectorDifference
    		(
    			this.Grad[this.ppNext], 
    			this.Grad[this.ppCurrent], 
    			this.historyY[i]
    		);	
    		
    			//
    		this.historyInnerProductsSY[i] = this.innerProduct
    		(
    			this.historyS[i], 
    			this.historyY[i]
    		);		 
    
    		if(i === newestEntryIdex)
    		{
    			var denominator = this.innerProduct
    			(
    				this.historyY[i], 
    				this.historyY[i]
    			);		 
    			
    			this.previousStepInnerProductsSYYY = this.historyInnerProductsSY[i] / denominator;	
    		}
    			
    			// report, if needed		
    		var reportedStep = i + 1;
    			
    		if(reportedStep % stepsToReport === 1)
    		{
    			this.reportProgress("lbfgs init", reportedStep);
    		}							
    			
    			// swap ping-pong indices
    		this.ppCurrent = 1 - this.ppCurrent;
    		this.ppNext = 1 - this.ppNext; 
    	}
    	
    	return this;
    }
    
    AntigradientLbfgs.prototype.lbfgsTwoLoops = function()
    {
    	var dimension = this.problemDimension;
    	var m = this.historySize;
    	
    	// calcs new direction p
    	
    	for(var i = 0; i < dimension; ++i)
    	{
    		this.p[i] = -this.Grad[this.ppCurrent][i];
    	}
    	
    		// from current to past
    	for(var i = m - 1; i >= 0; --i)
    	{
    		var numerator = this.innerProduct
    		(
    			this.historyS[i], 
    			this.p
    		);
    		
    		var a = this.historyA[i] = numerator / this.historyInnerProductsSY[i];
    		
    		this.linearVectorExpression
    		(
    			this.p,
    			-a,
    			this.historyY[i],
    			this.p 
    		);		
    	}
    		
    	this.scaleVector(this.previousStepInnerProductsSYYY, this.p, this.p);
    	
    		// from past to current
    	for(var i = 0; i < m; ++i)
    	{
    		var numerator = this.innerProduct
    		(
    			this.historyY[i], 
    			this.p
    		);
    
    		var b = numerator / this.historyInnerProductsSY[i];
    
    		this.linearVectorExpression
    		(
    			this.p,
    			this.historyA[i] - b,
    			this.historyS[i],
    			this.p 
    		);				
    	}
    	
    	return this;
    }

    AntigradientLbfgs.prototype.makeStepsLbfgs = function
    	(
    		stepsToReport,
    		stepsCount, 
    		linearSearchStepsCount
    	)
    {
    	var m = this.historySize;	
    	
    	this.makeInitialSteps(stepsToReport, linearSearchStepsCount);
    	
    	if(this.weird || this.diverged || this.local)
    	{
    		return this.X[this.ppCurrent];
    	}	
    	
    	for(var step = 0; step < stepsCount; ++step)
    	{
    			// do L-BFGS stuff
    		this.lbfgsTwoLoops();
    			
    			//
    		this.linearSearch(linearSearchStepsCount);	
    		
    		if(isNaN(this.f[this.ppNext]))
    		{
    			this.weird = true;
    		}
    		
    		if(this.f[this.ppCurrent] < this.f[this.ppNext])
    		{
    			this.diverged = true;			
    		}
    		
    		if(this.weird || this.diverged)
    		{
    				// reset model to good point
    			this.gradF
    			(
    				this.X[this.ppCurrent],
    				this.Grad[this.ppCurrent]			
    			);		
    			
    			break;
    		}		
    
    		if(Math.abs(this.f[this.ppCurrent] - this.f[this.ppNext]) < this.epsilon)
    		{
    			this.local = true;
    			break;
    		}		
    		
    			// forget the oldest history entry, shift from past to current			
    				
    		var oldestS = this.historyS[0];
    		var oldestY = this.historyY[0];
    		
    		var newestEntryIdex = m - 1;
    		
    		for(var i = 0; i < newestEntryIdex; ++i)
    		{
    			var next = i + 1;
    			
    				// (we only re-assign pointers to arrays)
    			this.historyS[i] = this.historyS[next];
    			this.historyY[i] = this.historyY[next];
    			 
    			this.historyA[i] = this.historyA[next];
    			this.historyInnerProductsSY[i] = this.historyInnerProductsSY[next];
    		}	
    		
    			// (we only re-assign pointers to arrays)
    		this.historyS[newestEntryIdex] = oldestS;
    		this.historyY[newestEntryIdex] = oldestY; 
    		
    			// update newest stuff
    			
    		this.vectorDifference
    		(
    			this.X[this.ppNext], 
    			this.X[this.ppCurrent], 
    			this.historyS[newestEntryIdex]
    		);			 
    
    		this.vectorDifference
    		(
    			this.Grad[this.ppNext], 
    			this.Grad[this.ppCurrent], 
    			this.historyY[newestEntryIdex]
    		);	
    		
    			//
    		this.historyInnerProductsSY[newestEntryIdex] = this.innerProduct
    		(
    			this.historyS[newestEntryIdex], 
    			this.historyY[newestEntryIdex]
    		);		 
    
    		var denominator = this.innerProduct
    		(
    			this.historyY[newestEntryIdex], 
    			this.historyY[newestEntryIdex]
    		);		 
    
    		this.previousStepInnerProductsSYYY = this.historyInnerProductsSY[newestEntryIdex] / denominator;	 			
    			
    			// swap ping-pong indices
    		this.ppCurrent = 1 - this.ppCurrent;
    		this.ppNext = 1 - this.ppNext; 
    		
    			// report, if needed		
    		var reportedStep = step + 1;
    			
    		if(reportedStep % stepsToReport === 1)
    		{
    			this.reportProgress("lbfgs", reportedStep);
    		}							
    	}
    		
    	return this.X[this.ppCurrent];
    }

    AntigradientLbfgs.prototype.useOnProgress = function(callbackProgress)
    {
    	this.callbackProgress = callbackProgress;
    	
    	return this;
    }

    AntigradientLbfgs.prototype.reportProgress = function(phase, step)
    {
    	if(this.callbackProgress !== undefined)
    	{
    		this.callbackProgress(phase, step);
    	}
    	
    	return this;	
    }
    
    //////////////////  end of LBFGS stuff
    
    onmessage = function(e)
    {
        var workerArgs = e.data;
        
        var anfis = new UnormAnfis(workerArgs.pointDimension, workerArgs.anfisRulesCount);
        
        anfis.useParameters(workerArgs.anfisParameters);
        anfis.useTabPoints(workerArgs.tabPoints);
        anfis.useKnownOutput(workerArgs.knownOutput);
        anfis.evauateTabPoints();
        anfis.evaluateError();
        
        var initialError = anfis.currentError;
        
        const lbfgsHistorySize = 20;
        const epsilon = 1e-8;
        const linearSearchStepsCount = 20;
        const reportSteps = 20;

        var lbfgs = new AntigradientLbfgs(workerArgs.anfisParameters.length, lbfgsHistorySize);
        
        lbfgs.useInitialArgument(workerArgs.anfisParameters);
        
        lbfgs.useGradientProvider(function(vectorX, gradArray){
            
            anfis.useParameters(vectorX);  
            
            anfis.evaluateErrfGrad(gradArray);
            
            return anfis.currentError;
        });
        
        lbfgs.useEpsilon(epsilon);
        
        lbfgs.useOnProgress(function(phase, step){
            
            postMessage({info: 'phase: ' + phase + ', step: ' + step + ', f: ' + anfis.currentError});
        });
        
        lbfgs.reset();
        
        var optX = lbfgs.makeStepsLbfgs(reportSteps, workerArgs.lbfgsSteps, linearSearchStepsCount);
        
        var err = anfis.currentError;
        
        postMessage({
            done: true, 
            weird: lbfgs.weird, 
            diverged: lbfgs.diverged, 
            local: lbfgs.local,
            optX: optX, 
            error: err, 
            initialError: initialError
        });
    }
}

//-----------------------------------------------------------------------------

function isProperFootprint(footprint)
{
    return (footprint === 'initialized');
}

//-----------------------------------------------------------------------------

function processingBody(model, callbackOnDone)
{
    const decimalPlaces = 6;

    // srcContent is model
    // {footprint: 'initialized', rulesCount: anfisRulesCount, rangesMin: [], rangesMax: [], trainSet: [/*normalized*/], parameters: []};
    
    var pointsCount = model.trainSet.length;
    var fieldsCount = model.trainSet[0].length;
    var tabFieldsCount = fieldsCount - 1;
    
    var tabPoints = new Float64Array(pointsCount * tabFieldsCount);
    var knownOutput = new Float64Array(pointsCount);
    
        // split train set to tab points and known output
    
    var tabIndex = 0;
    
    for(var row = 0; row < pointsCount; ++row)
    {
        var record = model.trainSet[row];
        
        for(var col = 0; col < fieldsCount; ++col)
        {
            if(col < tabFieldsCount)
            {
                tabPoints[tabIndex] = record[col];
                ++tabIndex;
            }
            else
            {
                knownOutput[row] = record[col];
            }
        }
    }
        // 
    
    var workerUrl = URL.createObjectURL(new Blob(["(" + workerEntry.toString() + ")()"], {type: "application/javascript"}));        
    
    var worker = new Worker(workerUrl);
    
    URL.revokeObjectURL(workerUrl);
    
    worker.onmessage = function(e)
    {
        if(e.data.done)
        {
            worker.terminate();
            
            logInfo('Training done. {weird: ' + e.data.weird + 
                ', diverged: ' + e.data.diverged + 
                ', local: ' + e.data.local + 
                '}, errSquared: ' + decimalRound(e.data.error, decimalPlaces) + 
                ', initial errSquared: ' + decimalRound(e.data.initialError, decimalPlaces));
            
            model.optimizedParameters = [];
            
            var optParams = e.data.optX;
            
            var parametersCount = optParams.length;
            
            for(var i = 0; i < parametersCount; ++i)
            {
                model.optimizedParameters.push(decimalRound(optParams[i], decimalPlaces));
            }
            
            model.footprint = 'trained';
            
            callbackOnDone(model);
        }
        else if(e.data.info)
        {
            logInfo(e.data.info);
        }
        else
        {
            logInfo(e.data.debugInfo);
        }
    }
    
    worker.postMessage({
        pointDimension: tabFieldsCount,
        anfisRulesCount: model.rulesCount, 
        anfisParameters: model.parameters,
        tabPoints: tabPoints, 
        knownOutput: knownOutput,
        lbfgsSteps: 300
    });    
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
        
    var token = 'int_train-maintrain';
    
        //
        
    function reportErrorAndStop(phases, phaseEntryIndex)
    {
        var entry = phases[phaseEntryIndex];
        
        logInfo('Error processing items for token ' + entry.args.token + '; stopped.');   
        
        // no need killing watchdog, just change script
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
            
        phases[2].args.src = phases[0].args.registry = {};     
        phases[2].args.res = phases[1].args.registry = {};    
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
                
                phases[0].proc(phases, 0);
                
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
                    
                    phases[0].proc(phases, 0);
                }
                else
                {
                    logInfo('Processing item ' + name);
                    
                        // process item (async for heavy load) and go to write result phase
                    
                    processingBody(response.reply, function(modelObject){
                        
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
                    // on error it is better to restart
                phases[0].proc(phases, 0);
            }
            
        }, function(){
            
                // on error it is better to restart
            phases[0].proc(phases, 0);
        });        
    }
    
    function writeResult(phase, phaseEntryIndex)
    {
        var entry = phases[phaseEntryIndex];
        
        logInfo('Writing result ' + entry.args.name);
        
        // even if any problem occured, we have nothing to do with it - go to next cycle
        
        redisPostCommand('YAD_CREATE_ITEM', [entry.args.resFolder, entry.args.name, entry.args.resultContent], function(response){
            
            // watchdog restart!
            
            phases[0].proc(phases, 0);
            
        }, function(){
            
            // watchdog restart!
            
            phases[0].proc(phases, 0);
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
    
    const phaseRandomSelection = 3;
    const phaseProcessing = 5;
    const phaseRevision = 6;
    const phaseWriteResult = 7;
    const phaseStopOnError = 8;
    
    var phases = 
    [
    /*0*/   {proc: getList, args: {inFolder: srcFolder, registry: sourceItems}},
    /*1*/   {proc: getList, args: {inFolder: resFolder, registry: resultItems}},
    /*2*/   {proc: createPotentialWorkset, args: {src: sourceItems, res: resultItems, token: token}},
    /*3*/   {proc: randomSelection, args: {token: token}},
    /*4*/   {proc: checkAtomic, args: {token: token}},
    /*5*/   {proc: processItem, args: {srcFolder: srcFolder}},
    /*6*/   {proc: reviseItem, args: {}},
    /*7*/   {proc: writeResult, args: {resFolder: resFolder}},
    /*8*/   {proc: reportErrorAndStop, args: {token: token}}
    ];
    
    phases[0].proc(phases, 0);
    
});

//-----------------------------------------------------------------------------

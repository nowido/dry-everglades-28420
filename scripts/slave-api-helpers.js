//-----------------------------------------------------------------------------
function askWorkItem(programId, key, onSuccess, onError)
{
    $.ajax({
        type : 'GET',
        data: { askWorkItem: true, programId: programId, key: key },
        success: onSuccess,
        error: onError
    });
}
//-----------------------------------------------------------------------------
function useResult(programId, key, content, onSuccess, onError)
{
    var ci = contentInfo(content);
    
    var qs = '/?useResult=true&programId=' + programId + '&key=' + key + '&contentType=' + ci.queryContentType;

    $.ajax({
        url: location.origin + qs,
        type : 'POST',
        contentType: ci.transferContentType,
        data: ci.dataToTransfer,
        processData: false,
        dataType: 'text',
        success: onSuccess,
        error: onError
    });
}
//-----------------------------------------------------------------------------

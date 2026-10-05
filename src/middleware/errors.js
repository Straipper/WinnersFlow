export function notFound(req,res){ res.status(404).json({error:'NOT_FOUND',path:req.path}); }
export function errorHandler(err,req,res,next){
  console.error(err);
  if(res.headersSent) return next(err);
  res.status(err.statusCode || 500).json({error:'INTERNAL_SERVER_ERROR'});
}

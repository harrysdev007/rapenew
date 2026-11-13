import {handleApi} from '../server/index.mjs';

export default async function handler(req,res){
  const route=req.query?.__api??new URL(req.url||'/','http://localhost').searchParams.get('__api')??undefined;
  return handleApi(req,res,route);
}

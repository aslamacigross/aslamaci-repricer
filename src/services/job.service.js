const logger=require("../config/logger");

class JobService{
  constructor({db,repository,handlers={}}){this.db=db;this.repository=repository;this.handlers=handlers;this.timer=null;}
  register(name,handler){this.handlers[name]=handler;}

  async run(name,metadata={}){
    const handler=this.handlers[name];if(!handler)throw new Error(`Bilinmeyen job: ${name}`);
    const client=await this.db.connect();let locked=false,run;
    try{
      const lock=await client.query("SELECT pg_try_advisory_lock(hashtext($1)) AS locked",[`aslamaci:${name}`]);locked=Boolean(lock.rows[0].locked);
      if(!locked)return {status:"SKIPPED",error:"Job zaten çalışıyor",processed:0};
      run=await this.repository.start(name,client);
      try{const result=await handler(metadata);return await this.repository.finish(run.id,{status:"SUCCESS",...result},client);}
      catch(error){logger.error("job_failed",{job:name,message:error.message});await this.repository.finish(run.id,{status:"FAILED",error:error.message},client);throw error;}
    }finally{if(locked)await client.query("SELECT pg_advisory_unlock(hashtext($1))",[`aslamaci:${name}`]);client.release();}
  }

  startScheduler(){
    if(this.timer)return;this.timer=setInterval(async()=>{
      try{const due=(await this.db.query(`SELECT name FROM jobs WHERE enabled=TRUE AND (last_run_at IS NULL OR last_run_at+schedule_minutes*INTERVAL '1 minute'<=NOW())`)).rows;
        for(const job of due){this.run(job.name,{source:"scheduler"}).catch(()=>{});await this.db.query("UPDATE jobs SET last_run_at=NOW(),next_run_at=NOW()+schedule_minutes*INTERVAL '1 minute' WHERE name=$1",[job.name]);}}
      catch(error){logger.error("scheduler_failed",{message:error.message});}
    },60000);this.timer.unref?.();
  }
  stopScheduler(){if(this.timer)clearInterval(this.timer);this.timer=null;}
}

module.exports={JobService};

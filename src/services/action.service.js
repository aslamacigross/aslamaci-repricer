const {AppError}=require("../utils/errors");
const {proposePrice,safetyCheck}=require("../domain/repricer");

class ActionService{
  constructor({db,withTransaction,actions,products,settings,trendyol,audit,repricer}){Object.assign(this,{db,withTransaction,actions,products,settings,trendyol,audit,repricer});}

  async approve(id,actor){
    const action=await this.actions.get(id);if(!action)throw new AppError("Aksiyon bulunamadı",404,"ACTION_NOT_FOUND");
    if(action.status!=="PENDING")throw new AppError("Yalnızca bekleyen aksiyon onaylanabilir",409,"INVALID_ACTION_STATE");
    return this.actions.updateStatus(id,"APPROVED",{actor});
  }

  async reject(id,actor){
    const action=await this.actions.get(id);if(!action)throw new AppError("Aksiyon bulunamadı",404,"ACTION_NOT_FOUND");
    const updated=await this.actions.updateStatus(id,"REJECTED",{actor});await this.audit.record({actor,action:"REPRICER_ACTION_REJECTED",entityType:"repricer_action",entityId:String(id),after:updated});return updated;
  }

  async apply(id,actor){
    const preparation=await this.withTransaction(async client=>{
      const locked=(await client.query("SELECT * FROM repricer_actions WHERE id=$1 FOR UPDATE",[id])).rows[0];
      if(!locked)throw new AppError("Aksiyon bulunamadı",404,"ACTION_NOT_FOUND");
      if(!["APPROVED","PENDING"].includes(locked.status))throw new AppError("Aksiyon daha önce işlendi veya uygun durumda değil",409,"DUPLICATE_APPLY");
      if(locked.status==="PENDING")throw new AppError("Aksiyon önce onaylanmalı",409,"ACTION_NOT_APPROVED");
      if(locked.expires_at&&new Date(locked.expires_at)<new Date())throw new AppError("Aksiyonun süresi dolmuş",409,"ACTION_EXPIRED");
      const product=await this.products.get(locked.barcode);if(!product)throw new AppError("Ürün bulunamadı",404,"PRODUCT_NOT_FOUND");
      if(Number(product.my_price)!==Number(locked.old_price))throw new AppError("Ürün fiyatı aksiyon üretildikten sonra değişmiş",409,"PRICE_MISMATCH");
      const open=await this.actions.findOpen(locked.barcode,client);if(open&&Number(open.id)!==Number(id))throw new AppError("Ürün için başka açık aksiyon var",409,"OPEN_ACTION_EXISTS");
      const global=await this.repricer.globalSettings();const settings=product.settings||{};const proposal=proposePrice(product,{...settings,learned_price_cut_tl:product.learning?.learned_price_cut_tl});
      proposal.proposedPrice=Number(locked.proposed_price);proposal.expectedProfit=Number(locked.expected_profit);proposal.expectedMargin=Number(locked.expected_margin);
      const today=await this.actions.todayStats(product.barcode,client);const safety=safetyCheck({product,settings:{...settings,auto_update:settings.auto_update??product.auto_update},global,proposal,today:{actionCount:today.action_count}});
      const hardFailures=safety.failures.filter(code=>code!=="DRY_RUN");if(hardFailures.length)throw new AppError("Fiyat güvenlik kontrollerinden geçmedi",409,"SAFETY_BLOCKED",hardFailures);
      if(global.dryRun){const updated=await this.actions.updateStatus(id,"DRY_RUN",{actor,apiResponse:{dryRun:true,safety}},client);return{dryRun:true,updated};}
      await this.actions.updateStatus(id,"SENDING",{actor},client);return{dryRun:false,locked};
    });
    if(preparation.dryRun){await this.audit.record({actor,action:"PRICE_ACTION_DRY_RUN",entityType:"repricer_action",entityId:String(id),after:preparation.updated});return preparation.updated;}
    const locked=preparation.locked;
    try{
      const response=await this.trendyol.updatePrices([{barcode:locked.barcode,salePrice:Number(locked.proposed_price),listPrice:Number(locked.proposed_price)}],{dryRun:false});
      const batchId=response.batchRequestId||response.batchId||null;const updated=await this.actions.updateStatus(id,"AWAITING_RESULT",{actor,appliedPrice:Number(locked.proposed_price),batchId,apiResponse:response});
      await this.audit.record({actor,action:"PRICE_ACTION_SENT",entityType:"repricer_action",entityId:String(id),after:{batchId}});return updated;
    }catch(error){await this.actions.updateStatus(id,"FAILED",{actor,error:error.message});await this.audit.record({actor,action:"PRICE_ACTION_FAILED",entityType:"repricer_action",entityId:String(id),after:{error:error.message}});throw error;}
  }
}

module.exports={ActionService};

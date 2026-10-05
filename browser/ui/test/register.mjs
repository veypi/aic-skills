import { registerHooks } from "node:module";
registerHooks({resolve(specifier,context,next){
 if(specifier.startsWith("/hosts/")) return next(new URL("../../../../aic/ui"+specifier,import.meta.url).href,context);
 return next(specifier,context);
}});

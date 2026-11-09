export type NativeFixtureOptions={version?:string;theme?:'light'|'dark';shortcut?:'unsupported'|'unknown'|'added'|'missed';confirm?:boolean};
type NativeState={main:{text:string;visible:boolean;active:boolean;progress:boolean;color?:string;textColor?:string};backVisible:boolean;mainListeners:number;backListeners:number;haptics:string[];confirmations:string[];links:string[];shortcutRequests:number;
  pressMain():void;pressBack():void;changeTheme(dark:boolean,params?:Record<string,string>):void;answerConfirm(yes:boolean):void;shortcutAdded():void};
declare global {interface Window {__qadamTelegram?:NativeState}}

// Serialized into the synthetic SDK response; deliberately no captured modules,
// credentials or network. Native controls are outside the document in Telegram.
export function installNativeFixture(app:Record<string,unknown>,options:NativeFixtureOptions){
  const mains=new Set<()=>void>(),backs=new Set<()=>void>(),events=new Map<string,Set<()=>void>>();
  let confirmAnswer:((yes:boolean)=>void)|undefined;
  const state:NativeState={main:{text:'',visible:false,active:true,progress:false},backVisible:false,mainListeners:0,backListeners:0,haptics:[],confirmations:[],links:[],shortcutRequests:0,
    pressMain(){if(state.main.visible&&state.main.active)for(const fn of [...mains])fn();},
    pressBack(){if(state.backVisible)for(const fn of [...backs])fn();},
    changeTheme(dark,params){app.colorScheme=dark?'dark':'light';app.themeParams=params??{};for(const fn of events.get('themeChanged')??[])fn();},
    answerConfirm(yes){const cb=confirmAnswer;confirmAnswer=undefined;cb?.(yes);},
    shortcutAdded(){for(const fn of events.get('homeScreenAdded')??[])fn();},
  };
  window.__qadamTelegram=state;
  app.colorScheme=options.theme??'light';app.themeParams={};
  app.isVersionAtLeast=(wanted:string)=>{const actual=(options.version??'8.0').split('.').map(Number),target=wanted.split('.').map(Number);return actual[0]>target[0]||(actual[0]===target[0]&&(actual[1]??0)>=(target[1]??0));};
  app.onEvent=(event:string,fn:()=>void)=>{if(!events.has(event))events.set(event,new Set());events.get(event)!.add(fn);};
  app.offEvent=(event:string,fn:()=>void)=>events.get(event)?.delete(fn);
  app.setHeaderColor=()=>{};app.setBackgroundColor=()=>{};
  app.MainButton={setParams(params:{text:string;is_visible:boolean;is_active:boolean;color?:string;text_color?:string}){state.main.text=params.text;state.main.visible=params.is_visible;state.main.active=params.is_active;state.main.color=params.color;state.main.textColor=params.text_color;},
    onClick(fn:()=>void){mains.add(fn);state.mainListeners=mains.size;},offClick(fn:()=>void){mains.delete(fn);state.mainListeners=mains.size;},show(){state.main.visible=true;},hide(){state.main.visible=false;},showProgress(){state.main.progress=true;state.main.active=false;},hideProgress(){state.main.progress=false;}};
  app.BackButton={onClick(fn:()=>void){backs.add(fn);state.backListeners=backs.size;},offClick(fn:()=>void){backs.delete(fn);state.backListeners=backs.size;},show(){state.backVisible=true;},hide(){state.backVisible=false;}};
  app.HapticFeedback={selectionChanged(){state.haptics.push('selection');},notificationOccurred(type:string){state.haptics.push(type);}};
  if(options.confirm!==false)app.showConfirm=(message:string,cb:(yes:boolean)=>void)=>{state.confirmations.push(message);confirmAnswer=cb;};
  app.openLink=(url:string)=>state.links.push(url);
  app.checkHomeScreenStatus=(cb:(status:string)=>void)=>cb(options.shortcut??'unknown');
  app.addToHomeScreen=()=>{state.shortcutRequests++;};
}

export const lightPalette = {
  ink:'#122f43',muted:'#526779',brand:'#2455db','brand-pressed':'#1740b5','brand-soft':'#eaf0ff',
  canvas:'#f3f6fa',surface:'#ffffff',line:'#dce5ef','button-text':'#ffffff',
  action:'#2455db','action-pressed':'#1740b5',
  warning:'#a54b21','warning-soft':'#fff1e8',success:'#216548','success-soft':'#e8f4ed',danger:'#ac2f35','danger-soft':'#fff0f1',
};
export const darkPalette: typeof lightPalette = {
  ink:'#edf4fb',muted:'#aabdd0',brand:'#80bdff','brand-pressed':'#a0ceff','brand-soft':'#203c58',
  canvas:'#101b26',surface:'#172737',line:'#354a5e','button-text':'#ffffff',
  action:'#2b6cbb','action-pressed':'#245b9e',
  warning:'#ffbe97','warning-soft':'#422e28',success:'#9ed8b8','success-soft':'#183a31',danger:'#ffb3ba','danger-soft':'#422b34',
};
export const validThemeColor = (value: unknown): value is string => typeof value === 'string' && /^#[\da-f]{6}$/i.test(value);
const rgb = (hex: string) => [1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255);
export function contrast(a: string,b: string) {
  const luminance=(hex:string)=>rgb(hex).map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4).reduce((s,c,i)=>s+c*[.2126,.7152,.0722][i],0);
  const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);
}
const blend=(a:string,b:string,weight:number)=>'#'+rgb(a).map((c,i)=>Math.round((c*weight+rgb(b)[i]*(1-weight))*255).toString(16).padStart(2,'0')).join('');
export function telegramPalette(dark: boolean,params: Record<string,string|undefined> = {}) {
  const fallback=dark?darkPalette:lightPalette;
  const color=(key:string,otherwise:string)=>validThemeColor(params[key])?params[key]!:otherwise;
  const surface=color('bg_color',fallback.surface),canvas=color('secondary_bg_color',fallback.canvas);
  // Custom themes must not make small text or the main action unreadable.
  const readable=(candidate:string)=>contrast(candidate,surface)>=4.5?candidate:contrast(fallback.ink,surface)>=4.5?fallback.ink:contrast('#000000',surface)>contrast('#ffffff',surface)?'#000000':'#ffffff';
  const brand=readable(color('link_color',fallback.brand));
  const action=color('button_color',fallback.action);
  const suppliedText=color('button_text_color',fallback['button-text']);
  const buttonText=contrast(suppliedText,action)>=4.5?suppliedText:contrast('#ffffff',action)>contrast('#000000',action)?'#ffffff':'#000000';
  const ink=readable(color('text_color',fallback.ink)),muted=readable(color('hint_color',fallback.muted));
  return {...fallback,surface,canvas:contrast(ink,canvas)>=4.5&&contrast(muted,canvas)>=4.5?canvas:surface,ink,muted,
    brand,action,'action-pressed':blend(action,surface,.85),'brand-pressed':blend(brand,surface,.85),'brand-soft':blend(brand,surface,.12),'button-text':buttonText,line:blend(readable(fallback.muted),surface,.3)};
}

import type { ReactNode } from 'react';

// A new browsing context lets Telegram's native WebView delegate tel: to the
// system dialer. Same-frame tel: navigation can be swallowed by the Mini App.
export function PhoneLink({phone,children,className}:{phone:string;children?:ReactNode;className?:string}) {
  const digits=phone.replace(/\D/g,'');
  const number=phone.trim().startsWith('+')?`+${digits}`:digits;
  return <a className={className} href={`tel:${number}`} target="_blank" rel="noopener noreferrer">{children??phone}</a>;
}

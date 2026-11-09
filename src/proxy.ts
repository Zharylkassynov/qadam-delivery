import {NextResponse,type NextRequest} from 'next/server';
export function proxy(request:NextRequest){
  const headers=new Headers(request.headers);headers.set('x-qadam-recipient-page','true');
  return NextResponse.next({request:{headers}});
}
export const config={matcher:'/t/:path*'};

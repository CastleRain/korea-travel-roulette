export const FRIENDS = Object.freeze(['지태근','장성우','이주열','성석근']);
export function recordPage(records, person='', requestedPage=1, size=6) {
  const filtered=records.filter(r=>!person || (person==='__legacy'?!FRIENDS.includes(r.travelerName):r.travelerName===person));
  const pages=Math.max(1,Math.ceil(filtered.length/size));
  const page=Math.max(1,Math.min(pages,requestedPage));
  return {items:filtered.slice((page-1)*size,page*size),total:filtered.length,pages,page};
}

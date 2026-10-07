import { expect, it } from 'vitest';
import { clusterScreenPlaces, markerScale } from './markerLayout';
const point = (index:number,x:number,y=100,selected=false) => ({index,x,y,selected});
it('확대 수준에 따라 개요·이름·사진 표시로 전환한다',()=>{
 expect([5,10.9,11,14.9,15,20].map(markerScale)).toEqual(['overview','overview','names','names','photos','photos']);
});
it('많은 기록과 같은 좌표 재방문도 누락 없이 숫자에 포함한다',()=>{
 const points=Array.from({length:500},(_,i)=>point(i,100+i%20,100+i%15));
 const clusters=clusterScreenPlaces(points,5);
 expect(clusters).toHaveLength(1);expect(clusters[0]!.indices).toHaveLength(500);
 expect(points[0]).toEqual(point(0,100));
});
it('격자 경계 양쪽의 가까운 지점을 합치고 확대하면 분리한다',()=>{
 expect(clusterScreenPlaces([point(0,63),point(1,65),point(2,200)],5).map(c=>c.indices)).toEqual([[0,1],[2]]);
 expect(clusterScreenPlaces([point(0,100),point(1,150)],5)).toHaveLength(1);
 expect(clusterScreenPlaces([point(0,100),point(1,150)],15)).toHaveLength(2);
});
it('선택한 지점은 묶음 밖에 유지하며 이름표만 줄이고 핀은 숨기지 않는다',()=>{
 const clusters=clusterScreenPlaces([point(0,100),point(1,100,100,true),point(2,100),point(3,200)],12);
 expect(clusters.map(c=>c.indices)).toEqual([[0,2],[1],[3]]);
 expect(clusters[1]).toMatchObject({selected:true,label:true});expect(clusters[2]!.label).toBe(false);
 expect(clusters.flatMap(c=>c.indices).sort()).toEqual([0,1,2,3]);
});
it('긴 이름표가 인접 숫자 마커를 덮지 않도록 순번 핀으로 줄인다',()=>{
 const clusters=clusterScreenPlaces([point(0,100),point(1,190),point(2,190)],12);
 expect(clusters.map(c=>c.indices)).toEqual([[0],[1,2]]);expect(clusters[0]!.label).toBe(false);
});

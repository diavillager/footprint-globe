# 로컬 배경 지도

`src/assets/land.ts`는 사용자 기록이 아니라 공개된 육지 윤곽이다. 설치된 `world-atlas`의 `land-110m.json`을 `topojson-client`로 변환해 앱에 포함한다. 실행 중 외부 지도 서버에 위치나 범위를 요청하지 않는다.

- 출처: [world-atlas](https://github.com/topojson/world-atlas), Natural Earth 4.1.0의 1:110m 육지 경계
- Natural Earth 데이터는 [public domain](https://www.naturalearthdata.com/about/terms-of-use/)이다. world-atlas 패키지의 라이선스는 ISC다.
- 재생성: `node scripts/prepare-land.cjs` (의존성 설치 후). 생성기는 사용자 파일을 입력받지 않는다.

축척이 작은 개략 배경으로, 도로·건물·정확한 해안선이나 이동 경로 추정에 사용하지 않는다. 확대해도 도로 지도가 나타나지 않는다.

## 상세 지도 검토 (2026-10-06)

현재 연결 미리보기는 MapTiler 상세 지도와 외부 요청 없는 개략 지구본을 선택할 수 있다. 사용자는 해외 여행을 포함한 전 세계 국가·지역·도시 이름과 상세 경계를 요구했으며, [상세 지도 명세](../specs/2026-10-06-005-detailed-map.md)에서 MapTiler·Google Maps를 비교한다. 사진은 MVP 이후 확장으로 옮겼다.

- 해안선 개선: 설치된 world-atlas의 50m 또는 10m 자료를 같은 방식으로 포함할 수 있다. 원본 TopoJSON 크기는 현재 110m 약 55 KB, 50m 약 546 KB, 10m 약 3.09 MB다. 변환 후 앱 용량과 렌더링 비용은 별도 측정이 필요하다. 이는 축척 표기이며 10m가 10미터 정확도라는 뜻은 아니다. [Natural Earth 상세 육지 자료](https://www.naturalearthdata.com/downloads/10m-physical-vectors/)로 바꿔도 동네 도로나 건물 지도는 되지 않는다.
- 도로·건물·지명: 별도의 상세 지도 데이터와 렌더링 구성이 필요하다. [MapLibre의 PMTiles 지원](https://maplibre.org/maplibre-gl-js/docs/examples/pmtiles/)과 [지역 단위 지도 추출](https://docs.protomaps.com/pmtiles/cli)을 활용하는 방향을 검토할 수 있다. 지도·글꼴·스타일을 로컬에 준비하면 외부 지도 요청 없이 구현하는 것도 가능하지만, 지역 범위·용량·라이선스·기존 지구본과의 연동 및 CSP는 설계와 검증이 필요하다. 현재 앱에 구현된 기능은 아니다.

사용자는 MapTiler 평가 후 실제 기록 화면의 지도 요청을 승인했다. 상세 지도는 조회 지역이 외부에 드러날 수 있음을 안내한다. 원본 JSON·시각·관측 ID는 외부로 보내지 않는다.

world-atlas 라이선스 고지:

```text
Copyright 2013-2019 Michael Bostock

Permission to use, copy, modify, and/or distribute this software for any purpose
with or without fee is hereby granted, provided that the above copyright notice
and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND
FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS
OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER
TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF
THIS SOFTWARE.
```

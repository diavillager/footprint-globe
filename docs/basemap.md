# 로컬 배경 지도

`src/assets/land.ts`는 사용자 기록이 아니라 공개된 육지 윤곽이다. 설치된 `world-atlas`의 `land-110m.json`을 `topojson-client`로 변환해 앱에 포함한다. 실행 중 외부 지도 서버에 위치나 범위를 요청하지 않는다.

- 출처: [world-atlas](https://github.com/topojson/world-atlas), Natural Earth 4.1.0의 1:110m 육지 경계
- Natural Earth 데이터는 [public domain](https://www.naturalearthdata.com/about/terms-of-use/)이다. world-atlas 패키지의 라이선스는 ISC다.
- 재생성: `node scripts/prepare-land.cjs` (의존성 설치 후). 생성기는 사용자 파일을 입력받지 않는다.

축척이 작은 개략 배경으로, 도로·건물·정확한 해안선이나 이동 경로 추정에 사용하지 않는다. 확대해도 도로 지도가 나타나지 않는다.

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

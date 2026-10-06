# 위치와 여행 기록 서비스 핵심 정리

이동 기록을 다시 보고, 여행지의 사진과 이야기를 남길 수 있는 서비스 7개를 정리했습니다. 각 서비스가 무엇을 해 주고 어떻게 쓰이는지에 집중했습니다.

확인일은 2026년 10월 6일입니다. 공식 안내를 바탕으로 정리했으며 실제 사용 시험은 하지 않았습니다. 자세한 출처와 확인 범위는 [상세 분석](similar-services-analysis.md)에 있습니다.

## 한눈에 보기

| 서비스 | 무엇을 하는 서비스인가요? | 중심이 되는 경험 |
| --- | --- | --- |
| [Dawarich](https://dawarich.app/) | 과거 위치 기록을 모아 보관하고 날짜와 장소로 찾아봅니다. | 오래 쌓인 기록을 관리하기 |
| [Dawarich Timeline Visualizer](https://dawarich.app/tools/timeline-visualizer/) | Google 이동 기록 파일을 열어 날짜별 방문과 이동을 살펴봅니다. | 파일을 열어 하루씩 돌아보기 |
| [Google Location Visualizer](https://github.com/alexkreidler/google-location-visualizer) | 날짜와 시간을 고르고 목록이나 지도에서 위치를 찾아봅니다. | 원하는 시점의 위치 찾기 |
| [Timeline Visualizer](https://timelinevisualizer.org/) | Google 이동 기록을 지도 위에서 재생하고 영상으로 저장합니다. | 이동 과정을 영상으로 만들기 |
| [Polarsteps](https://www.polarsteps.com/travel-tracker) | 여행 경로를 기록하면서 장소마다 사진과 이야기를 붙입니다. | 여행 중 기록하고 함께 보기 |
| [FindPenguins](https://findpenguins.com/why-choose-findpenguins) | 방문한 장소마다 글과 사진을 남기고 여행책이나 영상으로 만듭니다. | 장소별 여행 일기 만들기 |
| [Relive](https://www.relive.com/) | 걷기·달리기·자전거 등의 이동을 입체적인 영상으로 보여줍니다. | 한 번의 활동을 영상으로 돌아보기 |

## Dawarich

**여러 해의 위치 기록을 계속 모아 두고 찾아보는 서비스입니다.**

- 예전 Google 이동 기록을 가져오거나 휴대전화로 새 기록을 쌓습니다.
- 날짜·장소로 찾아보고 이동 경로, 자주 간 지역, 여행 기록을 살펴봅니다.
- 직접 운영하는 설치형에서는 별도의 사진 보관 서비스와 연결해 사진을 지도에서 볼 수 있습니다.

**알아둘 점:** 업체가 운영하는 서비스를 이용하거나 직접 설치해서 운영하는 방식입니다. 사진 연동은 설치 방식에 따른 조건을 확인해야 합니다. 아래의 간단한 파일 열람 도구와는 다릅니다. [공식 지도 안내](https://dawarich.app/interactive-map/)

## Dawarich Timeline Visualizer

**Google 이동 기록 파일을 열어 날짜별로 살펴보는 도구입니다.**

- 파일을 선택한 뒤 달력에서 하루를 고릅니다.
- 방문 목록과 이동 기록을 함께 보며 과거의 하루를 돌아봅니다.
- 기본 열람은 가입 없이 무료로 이용한다고 안내합니다.

**알아둘 점:** 업체 안내에 따르면 기본 열람은 브라우저 안에서 처리하지만, 별도의 계정 저장 버튼을 누르면 파일을 업체에 보냅니다. [공식 도구 안내](https://dawarich.app/tools/timeline-visualizer/)

## Google Location Visualizer

**날짜와 시간으로 위치 기록을 좁혀 보는 간단한 공개 도구입니다.**

- Google 이동 기록 파일을 선택하고 날짜를 고릅니다.
- 지도 위의 점을 누르면 해당 위치의 정보를 봅니다.
- 시간 목록에서 항목을 고르면 지도에서 그 위치로 이동합니다.

**알아둘 점:** 공개된 소개는 위치를 찾아보는 기능에 집중되어 있습니다. 사진 첨부와 여행 일기 기능은 확인되지 않았습니다. [제작자 설명](https://github.com/alexkreidler/google-location-visualizer)

## Timeline Visualizer

**이동 기록으로 짧은 여행 영상을 만드는 웹 도구입니다.**

- Google 이동 기록 파일을 열고 색상·재생 속도·영상 크기를 정합니다.
- 움직이는 표시를 따라 이동 과정을 보고 영상으로 저장합니다.
- 출발 부분과 끝부분을 영상에서 덜어낼 수 있습니다.

**알아둘 점:** 무료이며 가입이 필요 없다고 안내합니다. 파일은 브라우저에서 처리하지만 기본 배경지도는 외부에서 받아옵니다. 별도의 비공개 모드는 외부 지도를 받지 않는 그림 배경을 사용합니다. [공식 설명](https://timelinevisualizer.org/)

## Polarsteps

**여행 경로에 사진과 이야기를 붙이며 여행 일기를 만드는 앱입니다.**

- 여행 중 경로를 자동으로 기록하고 장소마다 사진·영상·글을 더합니다.
- 휴대전화와 컴퓨터에서 기록을 이어서 봅니다.
- 가족·친구에게 여행을 보여주거나 여행책으로 남깁니다.

**알아둘 점:** 인터넷 없이 경로를 기록할 수 있어도 기록을 휴대전화 안에만 보관하는 서비스는 아닙니다. 여행마다 공개 범위를 고르며, 기본값은 팔로워 공개입니다. [기록 기능](https://www.polarsteps.com/travel-tracker) · [공개 범위 안내](https://support.polarsteps.com/hc/en-us/articles/24267891448850-Who-can-see-my-Polarsteps-account-and-trips)

## FindPenguins

**방문한 장소 하나하나를 글과 사진으로 남기는 여행 앱입니다.**

- 여행을 만들고 장소·날짜·제목을 넣은 게시물을 추가합니다.
- 하루에 여러 장소를 각각 기록하고 사진·영상·문서를 붙일 수 있습니다.
- 원하면 이동 경로도 자동으로 기록하고, 여행을 책이나 하늘에서 내려다보는 영상으로 만듭니다.

**알아둘 점:** 기록하려면 가입이 필요합니다. 앱 기능은 무료라고 안내하며 인쇄 여행책은 별도 상품입니다. 사진은 게시물마다 개수 제한이 있습니다. [기본 사용법](https://support.findpenguins.com/hc/en-us/articles/360014103293-Learn-about-the-basics) · [첨부 한도](https://support.findpenguins.com/hc/en-us/articles/21685704715932-Limits-for-photos-videos-and-attachments-per-footprint)

## Relive

**한 번의 야외 활동을 입체적인 이동 영상으로 만드는 앱입니다.**

- 직접 활동을 기록하거나 다른 기록 앱·파일에서 가져옵니다.
- 이동한 길을 따라가는 영상을 만들고 공유합니다.
- 유료 Plus에서는 영상에 사진·짧은 동영상·음악 등을 넣고 편집합니다.

**알아둘 점:** 활동을 기록하는 무료 기능과 사진을 넣은 영상을 만드는 유료 기능을 구분해야 합니다. 불러올 기록에는 위치와 시각이 있어야 합니다. [가져오기 안내](https://support.relive.com/kb/guide/en/how-can-i-import-an-activity-to-relive-qQQJOMElbR/Steps/3692503) · [영상 사진 안내](https://support.relive.com/kb/guide/en/number-of-photos-and-or-videos-in-your-relive-video-HA9dqhYzNZ/Steps/3669589)

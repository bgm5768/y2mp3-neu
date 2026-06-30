# YT MP3 Converter

YouTube 영상을 오디오 파일로 변환하고, 저장 폴더의 음악을 바로 재생할 수 있는 Neutralinojs 데스크탑 앱입니다.

현재 앱은 `yt-dlp`와 `ffmpeg`를 필수 도구로 사용합니다. 두 도구가 없으면 설정 화면의 의존성 도구 영역에서 설치하거나 업데이트할 수 있고, 설치가 완료되기 전까지 변환 탭은 비활성화됩니다.

## 주요 기능

### 음악 플레이어

- 현재 저장 위치의 음악 파일을 재생합니다.
- 설정에서 저장 위치를 바꾸면 플레이어의 음악 폴더도 같은 경로로 동기화됩니다.
- 지원 확장자: `mp3`, `m4a`, `wav`, `ogg`, `opus`, `aac`, `flac`
- 재생 목록 검색을 지원합니다.
  - 제목 기준 검색
  - 파일명 기준 검색
  - 실시간 필터링
  - 검색 결과 없음 상태 표시
- 재생 목록 정렬을 지원합니다.
  - 제목순
  - 재생시간순
  - 오름차순 / 내림차순 전환
- 음악 파일의 메타데이터를 읽어 표시합니다.
  - 제목
  - 아티스트
  - 앨범
  - 썸네일 이미지
  - 파일명
  - 파일 크기
  - 재생 시간
- LP 레코드 형태의 플레이어 UI와 재생 중 회전 애니메이션을 제공합니다.
- 볼륨, 재생 순서, 반복/종료 동작을 저장합니다.
- 마지막으로 듣던 노래와 재생 위치를 저장하고 앱 재실행 시 복원합니다.
- 긴 MP3 파일도 파일 전체를 미리 읽지 않고 스트리밍 방식으로 재생합니다.
- seek bar 이동, 이전 곡, 다음 곡, 폴더 열기 기능을 제공합니다.

### YouTube 변환

- 단일 변환 화면과 다중 변환 화면을 하나의 통합 화면으로 처리합니다.
- URL 개수에 따라 자동으로 동작합니다.
  - URL 1개: 단일 변환처럼 처리
  - URL 2개 이상: 변환 대기열로 처리
- 여러 줄 입력이 가능한 textarea를 사용합니다.
- 다음 URL 입력 방식을 처리합니다.
  - 줄바꿈 구분
  - 공백 구분
  - 쉼표 구분
  - 여러 URL 한 번에 붙여넣기
  - `youtube.com`
  - `youtu.be`
  - YouTube Shorts URL
- 입력값 분석 결과를 표시합니다.
  - 유효한 URL 개수
  - 중복 제외 개수
  - 잘못된 URL 개수
- 중복 URL은 자동 제거합니다.
- 붙여넣기 버튼으로 클립보드의 여러 URL을 한 번에 입력할 수 있습니다.
- `Ctrl + Enter` 또는 `Cmd + Enter`로 변환을 시작할 수 있습니다.
- 유효한 URL 개수에 따라 변환 버튼 문구가 바뀝니다.
  - URL 없음: `URL을 입력해주세요`
  - URL 1개: `MP3 변환`
  - URL 2개 이상: `N개 변환 시작`
- 변환 대기열에서 항목별 상태와 진행률을 표시합니다.
  - 대기 중
  - 정보 불러오는 중
  - 변환 중
  - 완료
  - 실패
  - 취소됨
- 항목별 삭제, 취소, 재시도를 지원합니다.
- 완료 항목 삭제, 전체 삭제, 전체 시작/재시도 기능을 제공합니다.
- 다운로드 완료 시 토스트 알림을 표시하고 저장 폴더 열기 액션을 제공합니다.

### 변환 옵션

- 음질 선택
  - 96 kbps
  - 128 kbps
  - 192 kbps
  - 256 kbps
  - 320 kbps
- 출력 형식 선택
  - MP3
  - M4A
  - WAV
  - FLAC
- 썸네일 삽입과 메타데이터 삽입은 현재 기본 활성화되어 변환 요청에 적용됩니다.

### 설정

- 저장 위치는 내 PC 경로만 지원합니다.
- pCloud Drive와 Google Drive 저장 옵션은 제거되었습니다.
- 저장 위치 변경 시 변환 저장 위치와 음악 플레이어 폴더가 같은 경로를 사용합니다.
- ffmpeg와 yt-dlp 상태를 설정 탭의 의존성 도구 영역에서 확인합니다.
- 의존성 도구가 없으면 `없음 / 설치 필요` 상태로 표시합니다.
- 의존성 도구가 있으면 버전과 설치 위치를 표시합니다.
- 의존성 다운로드 중 진행률과 현재 단계를 표시합니다.

## 실행 방법

### 요구 사항

- Node.js 18 이상
- npm
- Windows 환경 기준으로 개발되어 있습니다.
- 최초 실행 또는 의존성 설치 시 인터넷 연결이 필요합니다.

### 설치

```bash
npm install
```

`npm install` 후 `scripts/postinstall.js`가 실행되며 다음 작업을 수행합니다.

- `bin/yt-dlp.exe` 다운로드
- `resources/bin/yt-dlp.exe` 복사
- `ffmpeg-static` 패키지의 ffmpeg를 `resources/bin/ffmpeg.exe`로 복사
- Neutralinojs 바이너리 준비

### 개발 실행

```bash
npm run dev
```

### 배포 빌드

```bash
npm run build
```

빌드 결과물은 Neutralinojs 설정에 따라 `dist/` 아래에 생성됩니다.

### GitHub 자동 업데이트 릴리스 준비

`neutralino.config.json`의 `version`을 올린 뒤 다음 명령을 실행합니다.

```bash
npm run release:prepare
```

명령이 끝나면 `dist/resources.neu`와 `dist/update.json`이 생성됩니다. GitHub Release 태그를 `v버전` 형식으로 만들고, 두 파일을 릴리스 에셋으로 업로드하면 기존 클라이언트가 GitHub 최신 릴리스의 `update.json`을 확인한 뒤 변경된 `resources.neu`를 내려받습니다.

Neutralino 바이너리 버전이나 실행 파일 자체가 바뀌는 배포는 `resources.neu`만으로 교체되지 않으므로 별도 설치 파일도 함께 배포해야 합니다.

## 의존성 도구 위치

앱은 ffmpeg와 yt-dlp를 다음 순서로 찾습니다.

### yt-dlp

1. 앱 실행 중 설치되는 런타임 bin 경로
2. `resources/bin/yt-dlp.exe`
3. `bin/yt-dlp.exe`
4. 시스템 PATH의 `yt-dlp.exe`

### ffmpeg

1. 앱 실행 중 설치되는 런타임 bin 경로
2. `resources/bin/ffmpeg.exe`
3. `node_modules/ffmpeg-static/ffmpeg.exe`
4. `bin/ffmpeg.exe`
5. 시스템 PATH의 `ffmpeg`

런타임 설치 경로는 Neutralino의 `data` 또는 `cache` 경로 아래 `yt-mp3-converter/bin` 폴더를 우선 사용합니다. 앱에서 설치/업데이트를 실행하면 설정 탭에 실제 설치 위치가 표시됩니다.

## 프로젝트 구조

```text
mp3ver3/
├─ package.json
├─ package-lock.json
├─ neutralino.config.json
├─ README.md
├─ cookies.txt
├─ bin/
├─ dist/
├─ extension/
│  └─ app.js
├─ resources/
│  ├─ index.html
│  ├─ css/
│  │  └─ style.css
│  ├─ icons/
│  │  └─ app.png
│  └─ js/
│     ├─ neutralino.js
│     ├─ neutralino.d.ts
│     ├─ settings.js
│     ├─ queue.js
│     ├─ ytdlp.js
│     ├─ main.js
│     ├─ converter.js
│     └─ native-safety.js
└─ scripts/
   ├─ postinstall.js
   ├─ generate-update-manifest.js
   └─ postbuild.js
```

## 코드 파일 설명

### 루트

| 파일 | 역할 |
| --- | --- |
| `package.json` | npm 스크립트와 Node 의존성 정의 |
| `package-lock.json` | npm 의존성 잠금 파일 |
| `neutralino.config.json` | Neutralinojs 앱 설정, 창 크기, 권한, 빌드 옵션 정의 |
| `cookies.txt` | YouTube 인증이 필요한 영상에 사용할 수 있는 쿠키 파일 |
| `README.md` | 프로젝트 기능과 구조 문서 |

### `resources/`

| 파일 | 역할 |
| --- | --- |
| `resources/index.html` | 플레이어, 변환, 설정 탭의 DOM 구조 |
| `resources/css/style.css` | 다크 테마, 플레이어 UI, 변환 대기열, 설정 화면 스타일 |
| `resources/icons/app.png` | 앱 아이콘 |
| `resources/favicon.ico` | 브라우저/앱 favicon |

### `resources/js/`

| 파일 | 역할 |
| --- | --- |
| `neutralino.js` | Neutralinojs 클라이언트 라이브러리 |
| `neutralino.d.ts` | Neutralinojs 타입 정의 |
| `settings.js` | 저장 위치, 변환 옵션, 플레이어 설정, 마지막 재생 정보 저장/로드 |
| `queue.js` | 변환 대기열의 항목 추가, 삭제, 상태 변경, 재시도 상태 관리 |
| `ytdlp.js` | yt-dlp/ffmpeg 실행, 의존성 검사, 설치/업데이트, 영상 정보 조회, 다운로드/변환, 진행률 파싱 |
| `main.js` | 앱 초기화, 탭 전환, 토스트, URL 파싱, 변환 UI, 대기열 UI, 음악 플레이어 UI/상태/재생 로직 |
| `converter.js` | Neutralino Extension 방식 변환 통신 레이어입니다. 현재 HTML에는 로드되지 않는 보조/레거시 파일입니다. |
| `native-safety.js` | Native API payload 디버깅용 래퍼입니다. 현재 HTML에는 로드되지 않는 진단용 파일입니다. |

현재 실제 화면에서 로드되는 JS 순서는 다음과 같습니다.

```html
<script src="js/neutralino.js"></script>
<script src="js/settings.js"></script>
<script src="js/queue.js"></script>
<script src="js/ytdlp.js"></script>
<script src="js/main.js"></script>
```

### `scripts/`

| 파일 | 역할 |
| --- | --- |
| `scripts/postinstall.js` | npm 설치 후 yt-dlp, ffmpeg, Neutralinojs 바이너리를 준비 |
| `scripts/generate-update-manifest.js` | GitHub Release 자동 업데이트용 `dist/resources.neu`, `dist/update.json` 생성 |
| `scripts/postbuild.js` | 빌드 후처리용 파일입니다. 현재 내용은 비어 있습니다. |

### `extension/`

| 파일 | 역할 |
| --- | --- |
| `extension/app.js` | Neutralino Extension 기반 다운로드/변환 로직입니다. 현재 UI는 `resources/js/ytdlp.js`의 직접 실행 방식을 사용하므로 주 실행 경로는 아닙니다. |

## 현재 제거되었거나 사용하지 않는 기능

- 단일 변환 탭과 다중 변환 탭의 분리 UI는 제거되었습니다.
- 대기열에 추가한 뒤 별도로 시작하는 흐름은 기본 흐름이 아닙니다. 변환 버튼을 누르면 유효한 URL이 바로 대기열에 등록되고 실행됩니다.
- pCloud Drive 저장 위치는 제거되었습니다.
- Google Drive 저장 위치는 제거되었습니다.
- 사이드바 하단의 ffmpeg/yt-dlp 상태 표시는 제거되었습니다. 현재 의존성 정보는 설정 탭에서만 표시합니다.
- `converter.js`와 `extension/app.js`는 남아 있지만 현재 HTML에서 로드되는 주 변환 경로는 `ytdlp.js`입니다.

## 저장되는 설정

Neutralino Storage에 다음 사용자 설정이 저장됩니다.

- 저장 위치
- 선택한 음질
- 선택한 출력 형식
- 플레이어 볼륨
- 재생 순서
- 반복/종료 동작
- 마지막으로 들은 노래
- 마지막 재생 위치
- 마지막으로 확인한 재생 시간

## 개발 메모

- 변환 기능은 ffmpeg와 yt-dlp가 모두 정상 설치된 경우에만 사용할 수 있습니다.
- 의존성이 없으면 설정 탭에서 설치/업데이트를 먼저 실행해야 합니다.
- 플레이어는 설정의 저장 위치를 기준으로 음악 파일을 다시 스캔합니다.
- 새 음악을 다운로드한 뒤에는 플레이어 라이브러리를 갱신하여 재생 목록에 반영합니다.
- 긴 MP3 파일의 재생과 seek 동작을 위해 플레이어 내부에서 스트리밍 재생 경로를 사용합니다.

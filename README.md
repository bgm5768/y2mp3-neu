# YT → MP3 Converter

YouTube 영상을 MP3(또는 M4A/WAV/FLAC)로 변환하는 데스크탑 앱.  
[Neutralinojs](https://neutralino.js.org/) + [yt-dlp](https://github.com/yt-dlp/yt-dlp) + [ffmpeg-static](https://github.com/eugeneware/ffmpeg-static) 기반.

---

## 🚀 빠른 시작

### 사전 요건
- **Node.js 18+** 설치 필요
- 인터넷 연결 (yt-dlp 바이너리 자동 다운로드)

### 설치 & 실행

```bash
# 의존성 설치 (yt-dlp, ffmpeg-static, Neutralinojs 바이너리 자동 설치)
npm install

# 개발 모드 실행
npm run dev

# 배포용 빌드
npm run build
```

---

## ✨ 주요 기능

| 기능 | 설명 |
|------|------|
| **URL 변환** | YouTube URL 입력 → MP3/M4A/WAV/FLAC 변환 저장 |
| **음질 선택** | 96 / 128 / 192 / 256 / 320 kbps |
| **썸네일·메타데이터 삽입** | 앨범 아트 및 제목 자동 태깅 |
| **배치 대기열** | 여러 URL 한 번에 처리 |
| **저장 위치 선택** | 내 PC / pCloud Drive / Google Drive 폴더 지정 |
| **쿠키 인증** | 비공개·멤버십·성인 인증 영상 지원 (`cookies.txt`) |
| **프록시 지원** | HTTP/SOCKS 프록시 설정 |
| **속도 제한** | 다운로드 대역폭 제한 옵션 |
| **ffmpeg 번들** | `ffmpeg-static` 으로 별도 설치 불필요 |
| **yt-dlp 자동 업데이트** | 설정 탭에서 버튼 클릭으로 최신 버전 갱신 |

---

## 📁 프로젝트 구조

```
mp3ver3/
├── neutralino.config.json    # Neutralinojs 설정
├── package.json
├── bin/                      # yt-dlp 바이너리 (postinstall 자동 생성)
├── extension/
│   └── app.js                # Node.js 백엔드 Extension
├── resources/
│   ├── index.html            # 메인 UI
│   ├── css/
│   │   └── style.css
│   ├── js/
│   │   ├── neutralino.js     # Neutralinojs 클라이언트 라이브러리
│   │   ├── settings.js       # 설정 관리
│   │   ├── queue.js          # 배치 대기열 상태
│   │   ├── converter.js      # Extension 통신 레이어
│   │   └── main.js           # UI 이벤트 바인딩
│   └── icons/
└── scripts/
    └── postinstall.js        # npm install 후 자동 실행
```

---

## 🍪 쿠키 설정 (비공개 영상)

1. Chrome/Firefox에 **"Get cookies.txt LOCALLY"** 확장 설치
2. YouTube에 로그인 후 확장에서 `cookies.txt` 내보내기
3. 앱 **설정 탭 → 쿠키 설정 → 파일 선택** 에서 등록

---

## ☁️ 클라우드 저장소 연동

pCloud Drive 또는 Google Drive를 PC에 마운트한 후,  
**설정 탭 → 저장 위치** 에서 해당 드라이브 폴더를 경로로 지정하면  
변환된 파일이 자동으로 클라우드에 동기화됩니다.

---

## 🔧 의존성

| 패키지 | 역할 |
|--------|------|
| `yt-dlp-wrap` | yt-dlp Node.js 래퍼 |
| `ffmpeg-static` | ffmpeg 바이너리 번들 |
| `fs-extra` | 파일 시스템 유틸리티 |
| `@neutralinojs/neu` | Neutralinojs CLI |
| `ws` | WebSocket (Extension 통신) |

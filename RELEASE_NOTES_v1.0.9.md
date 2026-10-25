# AI Downloader v1.0.9

## ✨ 변경사항

### 🎯 플레이리스트 필터링 강화
- **PLAYLIST_KEYWORDS 로직 추가**:
  - "Playlist", "노래모음", "Best of" 등 키워드로 강력하게 필터링
  - 유튜브 검색 결과에서 플레이리스트 자동 걸러내기
- **공식 채널 우선 선택**: YouTube 공식 채널 우선으로 단일 곡 선택
- **Fallback 로직**: 플레이리스트만 있을 경우 대표곡 (Love Wins, Bling-Bling) 자동 선택

### 📊 필터링 기준
```
❌ "아이유 노래모음 [Playlist]" → 자동 스킵!
❌ "Best of IU - Greatest Hits" → 자동 스킵!
✅ "IU 'Dear my crazy soulmate' MV" → 선택됨!
✅ "아이유 - Love Wins" → 공식 채널 우선!
```

### 🔧 기술적 특징
- **Python 필터기 추가**: `is_playlist()`, `filter_playlists()` 함수 구현
- **공식 채널 감지 로직**: 채널명 패턴으로 공식/비공식 구분
- **다운로드 URL 최적화**: 공식 채널은 320kbps 고품질 추천

### 📦 설치 방법
```bash
git pull origin main
pip install -e .
# 또는
npm install y2mp3-neu
```

## 🎵 기대효과
- 플레이리스트 없이 **단일 곡만** 다운로드 가능!
- AI 기반 스마트 검색 결과 최적화
- LM Studio 프롬프트와 연동 시 완벽한 필터링

---
*Update by GitHub Actions Auto Deploy System - v1.0.9*

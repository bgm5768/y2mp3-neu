# Auto Update

이 앱은 GitHub 최신 공개 Release를 확인하고, Release 에셋의 `resources.neu`를 내려받아 현재 앱 폴더의 `resources.neu`를 교체합니다.

## 동작 방식

1. 앱은 `https://api.github.com/repos/bgm5768/y2mp3-neu/releases/latest`를 확인합니다.
2. 최신 Release의 태그에서 버전을 읽습니다. 예: `v1.0.1` -> `1.0.1`
3. 현재 앱 버전보다 최신이면 Release 에셋의 `resources.neu`를 다운로드합니다.
4. 다운로드가 끝나면 현재 앱 폴더의 `resources.neu`를 교체합니다.
5. 앱을 재시작하면 새 리소스가 적용됩니다.

GitHub Release asset URL은 브라우저 `fetch`에서 CORS/redirect 문제를 만들 수 있어서 Neutralino 내장 updater의 `update.json` 방식은 사용하지 않습니다. 대신 GitHub API로 Release 정보만 읽고, 실제 파일 다운로드는 Neutralino native command로 처리합니다.

## 배포 방법

1. `neutralino.config.json`의 `version`을 올립니다.
2. 변경사항을 `main`에 push합니다.
3. 같은 버전의 태그를 push합니다.

```bash
git tag v1.0.1
git push origin v1.0.1
```

태그는 반드시 `neutralino.config.json`의 `version`과 맞아야 합니다. 예를 들어 `version`이 `1.0.1`이면 태그는 `v1.0.1`이어야 합니다.

태그가 push되면 GitHub Actions의 `Release updater package` 워크플로가 실행되고, `dist/resources.neu`를 GitHub Release 에셋으로 업로드합니다.

## 수동 실행

GitHub Actions에서 `Release updater package` 워크플로를 수동 실행할 수도 있습니다. 태그 입력을 비우면 `neutralino.config.json`의 버전을 사용합니다.

## 요구 조건

- 저장소 또는 Release 에셋은 앱에서 토큰 없이 접근 가능해야 합니다.
- Release는 draft가 아니어야 합니다.
- 자동 업데이트 대상 Release는 prerelease가 아니어야 합니다.
- Release 에셋 이름은 `resources.neu`여야 합니다.
- GitHub Actions가 Release를 만들 수 있도록 `Settings > Actions > General > Workflow permissions`에서 `Read and write permissions`를 허용해야 합니다.

## 제한

`resources.neu`는 앱 리소스만 교체합니다. Neutralino 바이너리 버전, 실행 파일, WebView 관련 파일이 바뀌는 배포는 별도 설치 파일을 배포해야 합니다.

자동 업데이트 코드가 들어간 버전을 사용자가 한 번 설치해야 다음 버전부터 앱 내부 업데이트를 받을 수 있습니다.

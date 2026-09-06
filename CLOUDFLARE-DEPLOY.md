# GitHub에서 Cloudflare Workers로 배포

화면과 `/api/analyze`, `/api/ocr`, `/api/ask`, `/api/deduplicate`를 함께 배포합니다.
도메인은 구매하지 않고 Cloudflare의 `workers.dev` 기본 주소를 사용합니다.

## Cloudflare에 입력할 설정

GitHub에 이 프로젝트를 올린 뒤 Cloudflare의 Workers & Pages → Create application → Import a repository에서 저장소를 연결합니다.

| 항목 | 값 |
| --- | --- |
| Worker 이름 | `yaksok` |
| 배포 브랜치 | 실제 코드를 올린 브랜치(예: `main`) |
| 루트 디렉터리 | 저장소 최상단에 package.json이 있으면 기본값 |
| Build command | `npm run build:cloudflare` |
| Deploy command | `npx wrangler deploy --config dist/server/wrangler.json` |

Node.js는 package.json의 요구사항인 22.13.0 이상을 사용합니다.
Worker 이름을 바꾸려면 `wrangler.cloudflare.jsonc`의 `name`과 Cloudflare 화면의 이름을 함께 바꿉니다.

## Gemini 키

Worker → Settings → Variables and Secrets → Add에서 다음을 등록하고 배포에 반영합니다.

- Type: Secret
- Variable name: `GEMINI_API_KEY`
- Value: 기존 API 키 값만 입력(따옴표와 `GEMINI_API_KEY=` 제외)

Build 전용 변수가 아니라 Worker 실행 환경의 Secret으로 등록해야 합니다.
키를 등록하기 전에는 분석 요청이 503을 반환할 수 있습니다.
키는 GitHub, 코드, 이 안내 파일에 넣지 않습니다. `.env`와 `.dev.vars*`는 업로드에서 제외됩니다.

## 로컬 확인

```sh
npm run build:cloudflare
npx wrangler deploy --config dist/server/wrangler.json --dry-run
```

두 번째 명령은 배포 파일만 검증하며 실제로 업로드하지 않습니다.
Cloudflare 로그인 후 로컬에서 실제 배포하려면 `npm run deploy:cloudflare`를 사용합니다.

## 설정의 역할

- `wrangler.cloudflare.jsonc`: Worker 이름, 서버 진입점, Node.js 호환성, 화면 파일 바인딩을 지정합니다.
- `scripts/build-cloudflare.mjs`: Windows/Linux에서 동일하게 Cloudflare용 빌드를 실행합니다.
- `vite.config.ts`: 직접 배포할 때 Wrangler 설정을 읽고 Sites 전용 패키징을 생략합니다.
- `dist/server/wrangler.json`: 빌드가 자동 생성한 최종 배포 설정입니다. 직접 수정하거나 GitHub에 올리지 않습니다.

기존 Sites용 빌드 설정과 `.openai/hosting.json`은 유지합니다.
Cloudflare에서는 일반 `npm run build` 대신 위의 `build:cloudflare` 명령을 사용하세요.

## 배포 후 확인

기본 주소에서 첫 화면, 텍스트 PDF 분석, 스캔 문자인식, 추가 질문을 차례로 확인합니다.
오류가 나면 Cloudflare 빌드 로그와 Worker 실행 로그를 확인합니다.
GitHub 저장소에 다음 변경을 push하면 연결된 브랜치가 자동으로 재배포됩니다.

공식 문서:
- https://developers.cloudflare.com/workers/ci-cd/builds/
- https://developers.cloudflare.com/workers/configuration/secrets/

# 운영 가이드

## ⚠️ 중요: 장기 운영 시 주의사항

### ⑤ 동일 이메일 반복 발송 → 스팸 필터 위험

**문제:**
- `config.json`의 제목과 본문이 고정되어 있음
- 매일 동일한 내용을 같은 수신자에게 반복 발송 시:
  - Gmail/수신 측 스팸 필터가 점진적으로 강화됨
  - 1~2개월 후 대다수 이메일이 스팸함으로 이동 가능
  - 발신자 평판 영구 손상 가능

**해결 방법:**

**옵션 1: 컨텐츠 로테이션 (권장)**
```json
// config.json 예시
{
  "subject": "오늘의 한국어 공부 - 2026년 2월 20일 🇰🇷",
  "body": "안녕하세요 {name}님!\n\n오늘의 주제: \"카페에서 주문하기\"\n☕ 아메리카노 주세요\n☕ 따뜻한 걸로 주세요\n\n..."
}
```

- **날짜 변경**: 제목에 날짜 포함 (`YYYY년 M월 D일`)
- **주제 변경**: 매주 또는 매일 주제 교체
- **인사말 변화**: "안녕하세요", "좋은 아침입니다", "반갑습니다" 등 로테이션

**옵션 2: 동적 컨텐츠 (고급)**
- Python 코드에서 날짜/요일/랜덤 주제 자동 생성
- 단, 코드 수정 필요 (현재는 config.json 그대로 사용)

**옵션 3: 수동 갱신**
- 주 1회 또는 월 1회 `config.json` 수동 편집
- 간단하지만 무인 운영 목표와 충돌

**권장 주기:**
- **최소**: 주 1회 제목/본문 변경
- **이상**: 매일 다른 내용 (날짜, 주제 등)

---

### ⑥ 바운스 누적 관리 (반복 실패 주소 제거)

**문제:**
- 존재하지 않는 이메일 주소에 반복 발송 시:
  - Gmail 발신자 평판 하락
  - 정상 이메일까지 스팸 분류될 확률 증가
  - 심하면 Gmail 계정 정지 가능

**Hard Bounce 예시:**
- `user@deleted-domain.com` (도메인 존재 안 함)
- `olduser@gmail.com` (계정 삭제됨)
- `typo@gmial.com` (오타)

**모니터링 방법:**

**1. GitHub Actions Summary 확인**
```
Actions 탭 → 최근 실행 → Summary 탭

### ❌ 실패한 수신자
| 이메일                 | 이름 | 에러                          |
|------------------------|------|-------------------------------|
| invalid@example.com    | 홍길동 | `SMTPDataError: 550 No such user` |
```

**2. 실패 패턴 식별**
- **일시적 실패**: "Mailbox full", "Temporary error" → 무시 가능
- **영구적 실패**: "No such user", "Domain not found" → 제거 필요

**3. Supabase에서 제거**
```sql
-- Supabase Dashboard → SQL Editor
DELETE FROM users 
WHERE email = 'invalid@example.com';
```

**또는 수신거부 처리:**
```sql
UPDATE users 
SET unsubscribed = true 
WHERE email = 'invalid@example.com';
```

**권장 주기:**
- **주 1회**: GitHub Actions Summary 확인
- **월 1회**: 반복 실패 주소 Supabase에서 제거
- **3회 연속 실패**: 즉시 제거 권장

**자동화 (선택사항):**
- DB에 `bounce_count` 컬럼 추가
- 3회 실패 시 자동 `unsubscribed=true`
- 단, DB 스키마 변경 필요 (사용자가 선호하지 않음)

---

## 📅 정기 점검 체크리스트

### 주간 (매주 월요일)
- [ ] GitHub Actions 실행 이력 확인 (지난 7일)
- [ ] Summary에서 실패 목록 확인
- [ ] config.json 컨텐츠 변경 (제목/본문)

### 월간 (매월 1일)
- [ ] 반복 실패 이메일 주소 제거 (Supabase)
- [ ] Supabase 프로젝트 활성 상태 확인
- [ ] Gmail 계정 상태 확인 (정지/경고 여부)

### 60일마다 (자동)
- [ ] Keep-Alive workflow 실행 확인 (자동 커밋 생성)
- [ ] GitHub Actions scheduled workflow 활성 상태 확인

---

## 🚨 긴급 상황 대응

### Gmail App Password 폐기됨
**증상:**
```
❌ 인증 실패 - 전체 중단: SMTPAuthenticationError
```

**해결:**
1. Google 계정 → 보안 → 2단계 인증 확인
2. 앱 비밀번호 → 새 비밀번호 생성
3. GitHub Settings → Secrets → `GMAIL_APP_PASSWORD` 업데이트
4. Actions 탭에서 수동 실행 (Run workflow)

### Supabase 프로젝트 일시 중지됨
**증상:**
```
❌ Supabase 데이터 조회 실패
```

**해결:**
1. https://supabase.com/dashboard 접속
2. 프로젝트 선택 → "Restore" 버튼 클릭
3. Actions 탭에서 수동 실행

### 대량 스팸 신고 (계정 제한)
**증상:**
- 정상 발송인데 대부분 스팸함으로 이동
- Gmail에서 "의심스러운 활동" 경고

**해결:**
1. 즉시 발송 중단 (workflow 비활성화)
2. config.json 컨텐츠 전면 개편
3. 수신거부 링크 명확히 표시
4. 2-3주 발송 중단 후 소량(10-20통)부터 재시작

---

## 📊 정상 운영 지표

### 성공률
- **정상**: 95% 이상
- **주의**: 90-95% (반복 실패 주소 확인 필요)
- **위험**: 90% 미만 (즉시 조사 필요)

### 실패 패턴
- **일시적 실패 (무시 가능)**: "Mailbox full", "Temporarily unavailable"
- **영구적 실패 (제거 필요)**: "No such user", "Domain not found"
- **Critical 에러 (즉시 대응)**: "Authentication failed", "Sender refused"

### GitHub Actions 실행
- **정상**: 매일 1회 (UTC 0시 = 한국 9시)
- **지연**: 15-60분 이내 (정상)
- **누락**: 24시간 이상 미실행 (점검 필요)

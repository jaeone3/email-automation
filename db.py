import os
import sys
import secrets
from supabase import create_client


def get_supabase_client():
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_KEY")

    if not url or not key:
        print("[오류] .env 파일에 SUPABASE_URL과 SUPABASE_KEY를 설정하세요.")
        sys.exit(1)

    return create_client(url, key)


def get_recipients():
    try:
        client = get_supabase_client()
    except Exception as e:
        print()
        print("=" * 60)
        print("  ❌ Supabase 클라이언트 생성 실패")
        print("=" * 60)
        print(f"  에러: {e}")
        print()
        print("  확인사항:")
        print("  1. .env 파일에 SUPABASE_URL과 SUPABASE_KEY가 있는지")
        print("  2. Supabase 대시보드에서 프로젝트가 활성 상태인지")
        print("     → https://supabase.com/dashboard")
        print("=" * 60)
        sys.exit(1)
    
    try:
        # email과 unsubscribe_token만 조회 (name 제거)
        response = client.table("users") \
            .select("email, unsubscribe_token") \
            .eq("unsubscribed", False) \
            .execute()
    except Exception as e:
        print()
        print("=" * 60)
        print("  ❌ Supabase 데이터 조회 실패")
        print("=" * 60)
        print(f"  에러: {e}")
        print()
        print("  가능한 원인:")
        print("  1. 네트워크 연결 문제")
        print("  2. Supabase 프로젝트가 일시 중지됨 (7일 비활성)")
        print("  3. API 키가 만료되거나 변경됨")
        print()
        print("  Supabase 대시보드 확인:")
        print("  → https://supabase.com/dashboard")
        print("=" * 60)
        sys.exit(1)

    recipients = []
    for row in response.data:
        email = row["email"]
        token = row.get("unsubscribe_token")
        
        # 토큰이 없으면 생성
        if not token:
            token = secrets.token_urlsafe(16)
            try:
                client.table("users") \
                    .update({"unsubscribe_token": token}) \
                    .eq("email", email) \
                    .execute()
                print(f"[DB] {email}에 토큰 생성: {token}")
            except Exception as e:
                print(f"[경고] {email} 토큰 저장 실패: {e}")
                print("  → 수신거부 링크가 작동하지 않을 수 있습니다.")
                # 토큰 없이 계속 진행 (발송은 됨, 수신거부만 안됨)
        
        recipients.append({
            "email": email,
            "unsubscribe_token": token
        })

    if not recipients:
        print("[경고] 발송 가능한 수신자가 없습니다.")
        print("(모두 수신거부했거나 users 테이블이 비어있습니다)")
        sys.exit(0)

    return recipients

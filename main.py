import json
import sys
import os
from pathlib import Path

from dotenv import load_dotenv

from sender import EmailSender
from db import get_recipients


def load_config():
    config_path = Path(__file__).parent / "config.json"
    if not config_path.exists():
        print("[오류] config.json 파일을 찾을 수 없습니다.")
        sys.exit(1)

    with open(config_path, "r", encoding="utf-8") as f:
        config = json.load(f)
    
    # 필수 필드 검증
    for key in ("subject", "body"):
        if key not in config or not config[key].strip():
            print(f"[오류] config.json에 '{key}' 필드가 비어있거나 없습니다.")
            sys.exit(1)
    
    # 발송 간격 검증
    delay_min = config.get("send_delay_min", 5)
    delay_max = config.get("send_delay_max", 15)
    if delay_min > delay_max:
        print(f"[오류] send_delay_min ({delay_min})이 send_delay_max ({delay_max})보다 큽니다.")
        sys.exit(1)
    
    # 배치 크기 검증 (Gmail 안전)
    batch_size = config.get("batch_size", 20)
    if batch_size > 100:
        print(f"[오류] batch_size ({batch_size})는 100 이하여야 합니다 (Gmail 안전 한도).")
        sys.exit(1)
    
    return config


def load_credentials():
    env_path = Path(__file__).parent / ".env"
    load_dotenv(env_path)

    address = os.getenv("GMAIL_ADDRESS")
    password = os.getenv("GMAIL_APP_PASSWORD")

    if not address or not password:
        print("[오류] .env 파일에 GMAIL_ADDRESS와 GMAIL_APP_PASSWORD를 설정하세요.")
        sys.exit(1)



    return address, password


def print_summary(config, recipients, address):
    print("=" * 50)
    print("  이메일 자동 발송 프로그램")
    print("=" * 50)
    print(f"  발신자    : {address}")
    print(f"  수신자 수 : {len(recipients)}명")
    print(f"  제목      : {config['subject']}")
    print(f"  본문 미리보기 : {config['body'][:50]}...")
    print(f"  발송 간격 : {config.get('send_delay_min', 5)}~{config.get('send_delay_max', 15)}초")
    print(f"  배치 크기 : {config.get('batch_size', 20)}통마다 {config.get('batch_pause', 120)}초 대기")
    print("=" * 50)








def main():
    config = load_config()
    address, password = load_credentials()

    print("[DB] Supabase에서 수신자 목록을 가져오는 중...")
    recipients = get_recipients()
    print(f"[DB] {len(recipients)}명의 수신자를 가져왔습니다.")

    config["recipients"] = recipients

    print_summary(config, recipients, address)

    print()
    with EmailSender(address, password, config) as sender:
        result = sender.send_all()

    # GitHub Actions Summary 생성
    if os.getenv('GITHUB_ACTIONS'):
        summary_file = os.getenv('GITHUB_STEP_SUMMARY')
        if summary_file:
            with open(summary_file, 'a', encoding='utf-8') as f:
                f.write("## 📧 이메일 발송 결과\n\n")
                f.write(f"- ✅ **성공**: {result['success']}명\n")
                f.write(f"- ❌ **실패**: {result['fail']}명\n")
                f.write(f"- 📊 **총 대상**: {result['total']}명\n")
                
                if result['total'] > 0:
                    success_rate = result['success'] / result['total'] * 100
                    f.write(f"- 📈 **성공률**: {success_rate:.1f}%\n\n")
                
                # 실패 목록 표 추가
                if result['fail'] > 0 and result['failed_list']:
                    f.write("### ❌ 실패한 수신자\n\n")
                    
                    # 컬럼 너비 계산
                    max_email_len = max(len(item['email']) for item in result['failed_list'])
                    max_email_len = max(max_email_len, len('이메일'))
                    
                    max_name_len = max(len(str(item.get('name', 'N/A'))) for item in result['failed_list'])
                    max_name_len = max(max_name_len, len('이름'))
                    
                    # 표 헤더
                    f.write(f"| {'이메일':<{max_email_len}} | {'이름':<{max_name_len}} | 에러 |\n")
                    f.write(f"|{'-'*(max_email_len+2)}|{'-'*(max_name_len+2)}|------|\n")
                    
                    # 표 내용
                    for item in result['failed_list']:
                        email = item['email']
                        name = str(item.get('name', 'N/A'))
                        error = item['error'][:80] + '...' if len(item['error']) > 80 else item['error']
                        f.write(f"| {email:<{max_email_len}} | {name:<{max_name_len}} | `{error}` |\n")

    print()
    print("=" * 50)
    print(f"  발송 결과: 성공 {result['success']} / 실패 {result['fail']} / 총 {result['total']}")
    
    # 콘솔에 실패 목록 출력
    if result['fail'] > 0 and result['failed_list']:
        print()
        print("  실패한 수신자:")
        for item in result['failed_list']:
            name_display = item.get('name', 'N/A')
            error_short = item['error'][:60] + '...' if len(item['error']) > 60 else item['error']
            print(f"    - {item['email']} ({name_display}): {error_short}")
    
    print("  상세 로그는 GitHub Actions 대시보드를 확인하세요.")
    print("=" * 50)
    
    # 실패가 있으면 workflow failed
    if result['fail'] > 0:
        sys.exit(1)


if __name__ == "__main__":
    main()

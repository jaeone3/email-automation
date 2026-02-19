import json
import sys
import argparse
from pathlib import Path
from datetime import date

from dotenv import load_dotenv
import os

from sender import EmailSender
from db import get_recipients


def load_config():
    config_path = Path(__file__).parent / "config.json"
    if not config_path.exists():
        print("[오류] config.json 파일을 찾을 수 없습니다.")
        sys.exit(1)

    with open(config_path, "r", encoding="utf-8") as f:
        return json.load(f)


def load_credentials():
    env_path = Path(__file__).parent / ".env"
    load_dotenv(env_path)

    address = os.getenv("GMAIL_ADDRESS")
    password = os.getenv("GMAIL_APP_PASSWORD")

    if not address or not password:
        print("[오류] .env 파일에 GMAIL_ADDRESS와 GMAIL_APP_PASSWORD를 설정하세요.")
        sys.exit(1)

    if address == "your_email@gmail.com":
        print("[오류] .env 파일에서 실제 Gmail 주소와 앱 비밀번호로 변경하세요.")
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


def confirm():
    answer = input("\n위 내용으로 발송하시겠습니까? (y/n): ").strip().lower()
    return answer == "y"


def check_already_sent_today():
    """오늘 이미 발송했는지 체크"""
    log_dir = Path(__file__).parent / "logs"
    log_dir.mkdir(exist_ok=True)
    
    lock_file = log_dir / f"sent_{date.today().isoformat()}.lock"
    
    if lock_file.exists():
        print()
        print("=" * 50)
        print(f"  ❌ 오늘({date.today()}) 이미 발송을 완료했습니다!")
        print("=" * 50)
        print(f"  락파일: {lock_file}")
        print(f"  내용: {lock_file.read_text(encoding='utf-8')}")
        print()
        print("  다시 발송하려면 위 파일을 삭제하세요.")
        print("=" * 50)
        sys.exit(0)
    
    return lock_file


def main():
    # 명령행 인자 파싱
    parser = argparse.ArgumentParser(description="이메일 자동 발송 프로그램")
    parser.add_argument("--yes", "-y", action="store_true", 
                        help="확인 없이 바로 발송 (자동화용)")
    args = parser.parse_args()
    
    # 중복 발송 체크
    lock_file = check_already_sent_today()
    
    config = load_config()
    address, password = load_credentials()

    print("[DB] Supabase에서 수신자 목록을 가져오는 중...")
    recipients = get_recipients()
    print(f"[DB] {len(recipients)}명의 수신자를 가져왔습니다.")

    config["recipients"] = recipients

    print_summary(config, recipients, address)

    # --yes 플래그가 없으면 확인 요청
    if not args.yes and not confirm():
        print("발송이 취소되었습니다.")
        sys.exit(0)

    print()
    with EmailSender(address, password, config) as sender:
        result = sender.send_all()

    # 발송 성공 시 락파일 생성
    from datetime import datetime
    lock_content = f"발송 완료: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n"
    lock_content += f"성공: {result['success']} / 실패: {result['fail']} / 총: {result['total']}"
    lock_file.write_text(lock_content, encoding='utf-8')

    print()
    print("=" * 50)
    print(f"  발송 결과: 성공 {result['success']} / 실패 {result['fail']} / 총 {result['total']}")
    print("  상세 로그는 logs/ 폴더를 확인하세요.")
    print("=" * 50)


if __name__ == "__main__":
    main()

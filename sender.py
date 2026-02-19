import smtplib
import random
import time
import logging
from email.mime.text import MIMEText
from email.utils import formatdate, make_msgid
from datetime import datetime, date
from pathlib import Path


class EmailSender:
    SMTP_SERVER = "smtp.gmail.com"
    SMTP_PORT = 587

    def __init__(self, gmail_address, gmail_app_password, config):
        self.address = gmail_address
        self.password = gmail_app_password
        self.subject = config["subject"]
        self.body = config["body"]
        self.recipients = config["recipients"]
        self.delay_min = config.get("send_delay_min", 5)
        self.delay_max = config.get("send_delay_max", 15)
        self.batch_size = config.get("batch_size", 20)
        self.batch_pause = config.get("batch_pause", 120)

        self.server = None
        self.logger = self._setup_logger()

    def _setup_logger(self):
        log_dir = Path(__file__).parent / "logs"
        log_dir.mkdir(exist_ok=True)

        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        log_file = log_dir / f"send_{timestamp}.log"

        logger = logging.getLogger(f"email_sender_{timestamp}")
        logger.setLevel(logging.INFO)

        file_handler = logging.FileHandler(log_file, encoding="utf-8")
        file_handler.setFormatter(
            logging.Formatter("%(asctime)s [%(levelname)s] %(message)s")
        )
        logger.addHandler(file_handler)

        console_handler = logging.StreamHandler()
        console_handler.setFormatter(
            logging.Formatter("%(asctime)s [%(levelname)s] %(message)s")
        )
        logger.addHandler(console_handler)

        return logger

    def connect(self):
        self.logger.info("Gmail SMTP 서버에 연결 중...")
        self.server = smtplib.SMTP(self.SMTP_SERVER, self.SMTP_PORT, timeout=30)
        self.server.starttls()
        self.server.login(self.address, self.password)
        self.logger.info("로그인 성공")

    def disconnect(self):
        if self.server:
            self.server.quit()
            self.server = None
            self.logger.info("SMTP 연결 종료")

    def __enter__(self):
        self.connect()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.disconnect()
        return False

    def _build_message(self, recipient):
        email = recipient["email"]
        token = recipient.get("unsubscribe_token", "")
        
        # 본문 그대로 사용 (개인화 없음)
        personalized_body = self.body
        
        # 수신거부 URL (GitHub Pages)
        unsubscribe_url = f"https://jaeone3.github.io/email-unsubscribe/unsubscribe.html?token={token}"
        
        # 본문 하단에 수신거부 링크 추가
        personalized_body += f"\n\n---\n수신거부: {unsubscribe_url}"
        
        msg = MIMEText(personalized_body, "plain", "utf-8")
        msg["From"] = self.address
        msg["To"] = email
        msg["Subject"] = self.subject
        msg["Date"] = formatdate(localtime=True)
        msg["Message-ID"] = make_msgid(domain=self.address.split("@")[1])
        
        # 수신거부 헤더 (실제 작동하는 URL)
        msg["List-Unsubscribe"] = f"<{unsubscribe_url}>"
        msg["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click"
        
        return msg

    def send_email(self, recipient):
        msg = self._build_message(recipient)
        email = recipient["email"]
        if self.server is not None:
            self.server.sendmail(self.address, email, msg.as_string())
        self.logger.info(f"발송 성공: {email}")

    def send_all(self):
        # 진행상황 파일 경로
        log_dir = Path(__file__).parent / "logs"
        log_dir.mkdir(exist_ok=True)
        progress_file = log_dir / f"progress_{date.today().isoformat()}.txt"
        
        # 이미 발송된 이메일 불러오기
        already_sent = set()
        if progress_file.exists():
            already_sent = set(progress_file.read_text(encoding='utf-8').strip().splitlines())
            self.logger.info(f"이전 진행상황: {len(already_sent)}명 이미 발송됨")
        
        # 남은 수신자만 필터링
        remaining = [r for r in self.recipients if r['email'] not in already_sent]
        total_original = len(self.recipients)
        total = len(remaining)
        success = 0
        fail = 0

        if total == 0:
            self.logger.info("모든 수신자에게 이미 발송 완료")
            return {"success": len(already_sent), "fail": 0, "total": total_original}

        self.logger.info(f"총 {total}명에게 발송 시작 ({len(already_sent)}명 건너뜀)")
        self.logger.info(f"제목: {self.subject}")

        for i, recipient in enumerate(remaining, 1):
            try:
                self.send_email(recipient)
                success += 1
                
                # 발송 성공 시 즉시 진행상황 기록
                with open(progress_file, "a", encoding="utf-8") as f:
                    f.write(f"{recipient['email']}\n")
                    
            except smtplib.SMTPServerDisconnected:
                self.logger.warning("연결이 끊어졌습니다. 재연결 시도 중...")
                self.connect()
                try:
                    self.send_email(recipient)
                    success += 1
                    
                    # 재시도 성공 시에도 기록
                    with open(progress_file, "a", encoding="utf-8") as f:
                        f.write(f"{recipient['email']}\n")
                        
                except Exception as e:
                    self.logger.error(f"발송 실패 (재시도 후): {recipient['email']} - {e}")
                    fail += 1
                    
            except smtplib.SMTPAuthenticationError as e:
                self.logger.critical(f"❌ 인증 실패 - 전체 중단: {e}")
                self.logger.critical("Gmail 계정 또는 앱 비밀번호를 확인하세요")
                break
                
            except smtplib.SMTPSenderRefused as e:
                self.logger.critical(f"❌ 발신자 거부 - 전체 중단: {e}")
                self.logger.critical("Gmail 계정 상태를 확인하세요 (정지 가능성)")
                break
                
            except smtplib.SMTPDataError as e:
                if 400 <= e.smtp_code < 500:
                    self.logger.critical(f"❌ Gmail 한도 초과 감지 - 전체 중단: {e}")
                    self.logger.critical(f"현재까지 발송: {success}명")
                    self.logger.critical("내일 다시 시도하거나 발송량을 줄이세요")
                    break
                else:
                    self.logger.error(f"발송 실패: {recipient['email']} - {e}")
                    fail += 1
                    
            except Exception as e:
                self.logger.error(f"발송 실패: {recipient['email']} - {e}")
                fail += 1

            # 배치 분할: batch_size마다 긴 대기
            if i % self.batch_size == 0 and i < total:
                self.logger.info(
                    f"[{i}/{total}] 배치 완료. {self.batch_pause}초 대기 중..."
                )
                time.sleep(self.batch_pause)
            elif i < total:
                delay = random.uniform(self.delay_min, self.delay_max)
                self.logger.info(f"[{i}/{total}] 다음 발송까지 {delay:.1f}초 대기")
                time.sleep(delay)

        total_success = len(already_sent) + success
        self.logger.info(f"발송 완료 - 성공: {total_success}, 실패: {fail}, 총: {total_original}")
        return {"success": total_success, "fail": fail, "total": total_original}

import smtplib
import random
import time
import logging
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.mime.image import MIMEImage
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
        self.unsubscribe_base_url = config.get("unsubscribe_base_url", "")
        self.brand_name = config.get("brand_name", "")
        self.cta_text = config.get("cta_text", "")
        self.cta_url = config.get("cta_url", "")
        self.social_instagram = config.get("social_instagram", "#")
        self.social_twitter = config.get("social_twitter", "#")
        self.social_facebook = config.get("social_facebook", "#")
        self.social_tiktok = config.get("social_tiktok", "#")

        self.server = None
        self.logger = self._setup_logger()
        self.template = self._load_template()
        self.logo_data = self._load_logo()
        self.icons = self._load_icons()

    def _load_template(self):
        template_path = Path(__file__).parent / "template.html"
        with open(template_path, "r", encoding="utf-8") as f:
            return f.read()

    def _load_logo(self):
        logo_path = Path(__file__).parent / "koko.png"
        if logo_path.exists():
            with open(logo_path, "rb") as f:
                return f.read()
        return None

    def _load_icons(self):
        icons = {}
        icon_dir = Path(__file__).parent
        for name in ["instagram", "x", "facebook", "tiktok"]:
            icon_path = icon_dir / f"icon_{name}.png"
            if icon_path.exists():
                with open(icon_path, "rb") as f:
                    icons[name] = f.read()
        return icons

    def _setup_logger(self):
        logger = logging.getLogger("email_sender")
        logger.setLevel(logging.INFO)
        
        if not logger.handlers:
            handler = logging.StreamHandler()
            handler.setFormatter(
                logging.Formatter("%(asctime)s [%(levelname)s] %(message)s")
            )
            logger.addHandler(handler)
        
        return logger



    def connect(self):
        self.logger.info("Gmail SMTP 서버에 연결 중...")
        self.server = smtplib.SMTP(self.SMTP_SERVER, self.SMTP_PORT, timeout=30)
        self.server.starttls()
        self.server.login(self.address, self.password)
        self.logger.info("로그인 성공")

    def disconnect(self):
        if self.server:
            try:
                self.server.quit()
                self.logger.info("SMTP 연결 종료")
            except Exception as e:
                # 연결이 이미 끊긴 경우 등 예외 발생 시 무시
                self.logger.warning(f"SMTP 종료 중 예외 발생 (무시됨): {e}")
            finally:
                self.server = None

    def __enter__(self):
        self.connect()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.disconnect()
        return False

    def _build_message(self, recipient):
        email = recipient["email"]
        name = recipient.get("display_name")
        token = recipient.get("unsubscribe_token", "")

        # 메인 텍스트
        greeting = "오늘 한국어를 배워보세요!"

        # 제목 개인화 ({name} → 실제 이름)
        if name:
            subject = self.subject.replace("{name}", name)
        else:
            subject = self.subject.replace("{name}님, ", "")

        # 수신거부 URL
        unsubscribe_url = f"{self.unsubscribe_base_url}?token={token}"

        # 본문 줄바꿈을 HTML <br>로 변환
        body_html = self.body.replace("\n", "<br>")

        # HTML 템플릿에 값 삽입
        html = self.template.format(
            brand_name=self.brand_name,
            greeting=greeting,
            body=body_html,
            cta_text=self.cta_text,
            cta_url=self.cta_url,
            unsubscribe_url=unsubscribe_url,
            streak_count=0,
            social_instagram=self.social_instagram,
            social_twitter=self.social_twitter,
            social_facebook=self.social_facebook,
            social_tiktok=self.social_tiktok
        )

        msg = MIMEMultipart("related")
        msg["From"] = self.address
        msg["To"] = email
        msg["Subject"] = subject
        msg["Date"] = formatdate(localtime=True)
        msg["Message-ID"] = make_msgid(domain=self.address.split("@")[1])
        msg["List-Unsubscribe"] = f"<{unsubscribe_url}>, <mailto:{self.address}?subject=unsubscribe>"

        # HTML 본문 추가
        msg.attach(MIMEText(html, "html", "utf-8"))

        # 로고 이미지 첨부 (CID 방식)
        if self.logo_data:
            logo = MIMEImage(self.logo_data, _subtype="png")
            logo.add_header("Content-ID", "<koko_logo>")
            logo.add_header("Content-Disposition", "inline", filename="koko.png")
            msg.attach(logo)

        # 소셜 미디어 아이콘 첨부 (CID 방식)
        for name, data in self.icons.items():
            icon = MIMEImage(data, _subtype="png")
            icon.add_header("Content-ID", f"<icon_{name}>")
            icon.add_header("Content-Disposition", "inline", filename=f"icon_{name}.png")
            msg.attach(icon)

        return msg

    def send_email(self, recipient):
        if self.server is None:
            raise smtplib.SMTPServerDisconnected("SMTP 서버에 연결되지 않았습니다")
        
        msg = self._build_message(recipient)
        email = recipient["email"]
        self.server.sendmail(self.address, email, msg.as_string())
        self.logger.info(f"발송 성공: {email}")

    def send_all(self):
        total = len(self.recipients)
        success = 0
        fail = 0
        failed_list = []

        self.logger.info(f"총 {total}명에게 발송 시작")
        self.logger.info(f"제목: {self.subject}")

        for i, recipient in enumerate(self.recipients, 1):
            try:
                self.send_email(recipient)
                success += 1
            except smtplib.SMTPServerDisconnected:
                self.logger.warning("연결이 끊어졌습니다. 재연결 시도 중...")
                try:
                    self.connect()
                    self.send_email(recipient)
                    success += 1
                except smtplib.SMTPServerDisconnected as reconnect_error:
                    # 재연결 실패 시 critical 로그 출력 후 break
                    self.logger.critical(f"❌ 재연결 실패 - 전체 중단: {reconnect_error}")
                    self.logger.critical("Gmail SMTP 서버에 연결할 수 없습니다. 네트워크 또는 서버 상태를 확인하세요.")
                    break
                except Exception as e:
                    self.logger.error(f"발송 실패 (재시도 후): {recipient['email']} - {e}")
                    failed_list.append({
                        "email": recipient['email'],
                        "name": recipient.get('name', 'N/A'),
                        "error": str(e)
                    })
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
                    failed_list.append({
                        "email": recipient['email'],
                        "name": recipient.get('name', 'N/A'),
                        "error": f"SMTPDataError: {e}"
                    })
                    fail += 1
                    
            except Exception as e:
                self.logger.error(f"발송 실패: {recipient['email']} - {e}")
                failed_list.append({
                    "email": recipient['email'],
                    "name": recipient.get('name', 'N/A'),
                    "error": str(e)
                })
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

        self.logger.info(f"발송 완료 - 성공: {success}, 실패: {fail}, 총: {total}")
        return {
            "success": success, 
            "fail": fail, 
            "total": total,
            "failed_list": failed_list
        }

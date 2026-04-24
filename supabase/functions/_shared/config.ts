// ============================================================
// Retention email config
// 7 languages × 4 days (D+1 / D+3 / D+7 / D+14) = 28 template sets
// Duolingo-style: Koko as emotional mascot.
// ============================================================

export type RetentionDay = 1 | 3 | 7 | 14;
export const RETENTION_DAYS: readonly RetentionDay[] = [1, 3, 7, 14] as const;

export const SUPPORTED_LANGUAGES = [
  "English",
  "Korean",
  "Japanese",
  "Chinese",
  "Spanish",
  "German",
  "French",
] as const;
export type SupportedLanguage = typeof SUPPORTED_LANGUAGES[number];

export const DEFAULT_LANGUAGE: SupportedLanguage = "English";

// Day-specific content. {name} is replaced with display_name (dropped if missing).
export interface DayContent {
  subject:         string;
  body:            string;
  greeting:        string;
  cta_text:        string;
  hero_image_url?: string; // per-day Koko reaction. undefined → DEFAULT_HERO_IMAGE 사용
}

// Shared across days within the same language.
export interface LanguagePack {
  unsubscribe_notice: string; // {{brand_name}} placeholder
  unsubscribe_text:   string;
  day_1:  DayContent;
  day_3:  DayContent;
  day_7:  DayContent;
  day_14: DayContent;
}

// ------------------------------------------------------------
// Brand-wide config (language-agnostic)
// ------------------------------------------------------------
export const COMMON_CONFIG = {
  brand_name: "Koko AI",
  // OneLink (AppsFlyer) 스마트 링크: 앱 있으면 앱 열기, 없으면 스토어로 폴백
  cta_url: "https://onelink.to/cxgatm",
  streak_count: 0,
  // 우리 Supabase Edge Function이 수신거부를 처리.
  unsubscribe_base_url:
    "https://evljahialeytwjpnjywm.supabase.co/functions/v1/unsubscribe",
  // 활성 소셜 계정만 유지
  social_instagram: "https://www.instagram.com/koko_contents/",
  social_tiktok: "https://www.tiktok.com/@koko_ai_official",
  social_youtube: "https://www.youtube.com/@Kcontents-everyday/",
  // 문의 / 회신 주소
  support_email: "jake@kokoai.im",
  reply_to_email: "jake@kokoai.im",
  // 사회적 증거 (언어 무관 유니버설 포맷)
  social_proof: "25,000+ learners · ⭐ 4.8",
};

// 법적 필수 정보 (CAN-SPAM / 정보통신망법)
export const BUSINESS_INFO = {
  company: "Koko",              // 상호
  ceo: "Jake",                  // 대표자
  business_number: "4645500789", // 사업자등록번호
  address: "서울 구로구 디지털로32길 30 코오롱디지털타워빌란트 706호",
};

// day별 image_url이 undefined면 이 값으로 폴백. (브랜드 로고)
export const DEFAULT_HERO_IMAGE =
  "https://evljahialeytwjpnjywm.supabase.co/storage/v1/object/public/email-assets/appicon.png";

export const SEND_CONFIG = {
  BATCH_SIZE: 20,
};

// ------------------------------------------------------------
// 7-language × 4-day Duolingo-style template pack
// 톤 곡선: D+1 애교 🥺 → D+3 걱정 😟 → D+7 슬픔 💔 → D+14 체념 😬
// ------------------------------------------------------------
export const EMAIL_CONTENT: Record<SupportedLanguage, LanguagePack> = {
  English: {
    unsubscribe_notice:
      "This email was sent because you agreed to receive notification emails from {{brand_name}}.",
    unsubscribe_text: "Unsubscribe",
    day_1: {
      subject:  "{name}, Koko is waiting for you 🥺",
      greeting: "Just 5 minutes. That's it.",
      body:     "One lesson and Koko's smile is back. Don't let your streak slip!",
      cta_text: "Practice now",
    },
    day_3: {
      subject:  "{name}, Koko is getting worried 😟",
      greeting: "3 days without Korean.",
      body:     "Your brain is already forgetting words. 5 minutes fixes it.",
      cta_text: "I'm back!",
    },
    day_7: {
      subject:  "{name}, a whole week without Korean 💔",
      greeting: "Koko misses you so much.",
      body:     "A week can turn into a month. Let's not let that happen. One lesson today.",
      cta_text: "Save my streak",
    },
    day_14: {
      subject:  "{name}, these reminders don't seem to work... 😬",
      greeting: "Maybe we should stop sending these?",
      body:     "Two weeks. If you're still with us, come back — Koko has been waiting.",
      cta_text: "I'm still here",
    },
  },

  Korean: {
    unsubscribe_notice:
      "본 메일은 회원님이 {{brand_name}} 알림 메일 수신에 동의하였기에 발송된 메일입니다.",
    unsubscribe_text: "수신거부",
    day_1: {
      subject:  "{name}님, Koko가 기다리고 있어요 🥺",
      greeting: "딱 5분만!",
      body:     "레슨 하나면 Koko가 다시 웃어요. 스트릭 지켜봐요!",
      cta_text: "지금 시작",
    },
    day_3: {
      subject:  "{name}님, Koko가 걱정 중이에요 😟",
      greeting: "3일이나 쉬셨네요.",
      body:     "뇌가 벌써 단어를 까먹고 있어요. 5분이면 복구돼요.",
      cta_text: "돌아왔어요",
    },
    day_7: {
      subject:  "{name}님, 일주일이나 못 봤어요 💔",
      greeting: "Koko가 너무 보고 싶대요.",
      body:     "일주일이 한 달이 될 수도 있어요. 오늘 레슨 하나만요.",
      cta_text: "스트릭 살리기",
    },
    day_14: {
      subject:  "{name}님, 이 알림, 효과가 없나봐요... 😬",
      greeting: "이제 메일 그만 보낼까요?",
      body:     "2주가 지났어요. 아직 여기 있다면, 돌아와요. Koko가 계속 기다려요.",
      cta_text: "아직 있어요",
    },
  },

  Japanese: {
    unsubscribe_notice:
      "本メールは、{{brand_name}}からの通知メール受信にご同意いただいたため送信されています。",
    unsubscribe_text: "配信停止",
    day_1: {
      subject:  "{name}さん、Kokoが待ってるよ 🥺",
      greeting: "たった5分でOK!",
      body:     "レッスン1つでKokoの笑顔が戻るよ。連続記録、守ろう!",
      cta_text: "今すぐ始める",
    },
    day_3: {
      subject:  "{name}さん、Kokoが心配してるよ 😟",
      greeting: "3日も休んだね。",
      body:     "脳はもう単語を忘れかけてる。5分で取り戻せるよ。",
      cta_text: "戻ってきたよ",
    },
    day_7: {
      subject:  "{name}さん、1週間も会えてないよ 💔",
      greeting: "Kokoがすごく寂しがってる。",
      body:     "1週間が1ヶ月になっちゃうかも。今日、レッスン1つだけ。",
      cta_text: "連続記録を救う",
    },
    day_14: {
      subject:  "{name}さん、このリマインダー、効いてないみたい... 😬",
      greeting: "もうメール、やめた方がいい?",
      body:     "2週間経ったよ。まだいるなら、戻ってきて。Kokoはずっと待ってる。",
      cta_text: "まだここにいるよ",
    },
  },

  Chinese: {
    unsubscribe_notice:
      "本邮件是因为您同意接收来自 {{brand_name}} 的通知邮件而发送的。",
    unsubscribe_text: "取消订阅",
    day_1: {
      subject:  "{name},Koko在等你 🥺",
      greeting: "只要5分钟!",
      body:     "一节课,Koko就又笑了。别断掉连续记录!",
      cta_text: "立刻开始",
    },
    day_3: {
      subject:  "{name},Koko开始担心了 😟",
      greeting: "3天没学韩语了。",
      body:     "大脑已经在忘记单词。5分钟就能救回来。",
      cta_text: "我回来啦",
    },
    day_7: {
      subject:  "{name},整整一周没见 💔",
      greeting: "Koko特别想你。",
      body:     "一周可能变成一个月。今天一节课就够。",
      cta_text: "守住连续记录",
    },
    day_14: {
      subject:  "{name},这些提醒好像没用啊... 😬",
      greeting: "要不就别发邮件了?",
      body:     "两周了。如果你还在,回来吧。Koko一直在等。",
      cta_text: "我还在",
    },
  },

  Spanish: {
    unsubscribe_notice:
      "Recibiste este correo porque aceptaste recibir notificaciones de {{brand_name}}.",
    unsubscribe_text: "Cancelar suscripción",
    day_1: {
      subject:  "{name}, Koko te está esperando 🥺",
      greeting: "Solo 5 minutos.",
      body:     "Una lección y Koko sonríe de nuevo. ¡No rompas la racha!",
      cta_text: "Practicar ahora",
    },
    day_3: {
      subject:  "{name}, Koko está preocupado 😟",
      greeting: "3 días sin coreano.",
      body:     "Tu cerebro ya está olvidando palabras. 5 minutos lo arreglan.",
      cta_text: "¡Volví!",
    },
    day_7: {
      subject:  "{name}, toda una semana 💔",
      greeting: "Koko te extraña muchísimo.",
      body:     "Una semana puede volverse un mes. No dejemos que pase. Una lección hoy.",
      cta_text: "Salvar la racha",
    },
    day_14: {
      subject:  "{name}, estos recordatorios no funcionan... 😬",
      greeting: "¿Dejamos de enviar emails?",
      body:     "Dos semanas. Si sigues ahí, vuelve. Koko sigue esperando.",
      cta_text: "Sigo aquí",
    },
  },

  German: {
    unsubscribe_notice:
      "Diese E-Mail wurde gesendet, weil du dem Erhalt von Benachrichtigungen von {{brand_name}} zugestimmt hast.",
    unsubscribe_text: "Abmelden",
    day_1: {
      subject:  "{name}, Koko wartet auf dich 🥺",
      greeting: "Nur 5 Minuten!",
      body:     "Eine Lektion und Koko lächelt wieder. Lass die Serie nicht reißen!",
      cta_text: "Jetzt üben",
    },
    day_3: {
      subject:  "{name}, Koko macht sich Sorgen 😟",
      greeting: "3 Tage ohne Koreanisch.",
      body:     "Dein Gehirn vergisst schon Wörter. 5 Minuten reichen, um sie zurückzuholen.",
      cta_text: "Bin zurück!",
    },
    day_7: {
      subject:  "{name}, eine ganze Woche 💔",
      greeting: "Koko vermisst dich sehr.",
      body:     "Eine Woche kann zu einem Monat werden. Lass uns das verhindern. Eine Lektion heute.",
      cta_text: "Serie retten",
    },
    day_14: {
      subject:  "{name}, diese Erinnerungen scheinen nicht zu wirken... 😬",
      greeting: "Sollen wir aufhören, E-Mails zu senden?",
      body:     "Zwei Wochen. Wenn du noch da bist, komm zurück. Koko wartet immer noch.",
      cta_text: "Ich bin noch hier",
    },
  },

  French: {
    unsubscribe_notice:
      "Vous recevez cet email car vous avez accepté de recevoir des notifications de {{brand_name}}.",
    unsubscribe_text: "Se désabonner",
    day_1: {
      subject:  "{name}, Koko t'attend 🥺",
      greeting: "Juste 5 minutes !",
      body:     "Une leçon et Koko sourit à nouveau. Ne casse pas ta série !",
      cta_text: "Pratiquer maintenant",
    },
    day_3: {
      subject:  "{name}, Koko s'inquiète 😟",
      greeting: "3 jours sans coréen.",
      body:     "Ton cerveau oublie déjà des mots. 5 minutes suffisent pour les retrouver.",
      cta_text: "Je suis revenu(e) !",
    },
    day_7: {
      subject:  "{name}, une semaine entière 💔",
      greeting: "Tu manques énormément à Koko.",
      body:     "Une semaine peut devenir un mois. Ne laissons pas ça arriver. Une leçon aujourd'hui.",
      cta_text: "Sauver la série",
    },
    day_14: {
      subject:  "{name}, ces rappels ne semblent pas marcher... 😬",
      greeting: "On arrête les emails ?",
      body:     "Deux semaines. Si tu es encore là, reviens. Koko attend toujours.",
      cta_text: "Je suis encore là",
    },
  },
};

// ------------------------------------------------------------
// Lookup helpers
// ------------------------------------------------------------

const DAY_KEY: Record<RetentionDay, keyof LanguagePack> = {
  1:  "day_1",
  3:  "day_3",
  7:  "day_7",
  14: "day_14",
};

/** Flat struct used by the renderer: day content + hero image (resolved) + unsubscribe copy. */
export interface RenderContent {
  subject:            string;
  body:               string;
  greeting:           string;
  cta_text:           string;
  hero_image_url:     string; // 항상 세팅됨 (undefined면 DEFAULT_HERO_IMAGE)
  unsubscribe_notice: string;
  unsubscribe_text:   string;
}

/**
 * 언어 + day 조합으로 최종 렌더링용 콘텐츠를 반환.
 * 지원하지 않는 언어면 DEFAULT_LANGUAGE로 폴백.
 * hero_image_url은 day별로 설정돼있으면 사용, 없으면 DEFAULT_HERO_IMAGE로 폴백.
 */
export function getEmailContent(
  language: string,
  day: RetentionDay,
): RenderContent {
  const pack =
    (EMAIL_CONTENT as Record<string, LanguagePack>)[language] ??
    EMAIL_CONTENT[DEFAULT_LANGUAGE];
  const dayContent = pack[DAY_KEY[day]] as DayContent;
  return {
    subject:            dayContent.subject,
    body:               dayContent.body,
    greeting:           dayContent.greeting,
    cta_text:           dayContent.cta_text,
    hero_image_url:     dayContent.hero_image_url ?? DEFAULT_HERO_IMAGE,
    unsubscribe_notice: pack.unsubscribe_notice,
    unsubscribe_text:   pack.unsubscribe_text,
  };
}

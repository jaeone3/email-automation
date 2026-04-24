interface TemplateParams {
  brand_name: string;
  greeting: string;
  body: string;
  cta_text: string;
  cta_url: string;
  hero_image_url: string; // day별 Koko 리액션 이미지 (없으면 기본 로고)
  streak_count: number;
  unsubscribe_url: string;
  unsubscribe_notice: string;
  unsubscribe_text: string;
  social_instagram: string;
  social_tiktok: string;
  social_youtube: string;
  support_email: string;
  business_company: string;
  business_ceo: string;
  business_number: string;
  business_address: string;
  // 사회적 증거 (예: "25K+ learners · ⭐ 4.8")
  social_proof: string;
}

// 모바일 최적화 포인트:
// - <table width="100%"> + max-width:600px → 좁은 화면에서 100%로 줄어듦
// - @media queries로 padding/font-size 축소
// - !important로 인라인 스타일 override (메일 클라이언트 표준 패턴)
const TEMPLATE = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no,address=no,email=no,date=no,url=no">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<title>{{brand_name}}</title>
<style>
  /* 기본 리셋 (일부 클라이언트 대응) */
  body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
  table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
  img { -ms-interpolation-mode: bicubic; border: 0; height: auto; line-height: 100%; outline: none; text-decoration: none; }

  /* 모바일 최적화 */
  @media only screen and (max-width: 600px) {
    .container      { width: 100% !important; }
    .brand-cell     { padding: 32px 20px 20px 20px !important; }
    .cta-cell       { padding: 0 24px 32px 24px !important; }
    .cta-link       { font-size: 16px !important; padding: 14px 16px !important; }
    .logo-cell      { padding: 0 20px 20px 20px !important; }
    .logo-img       { width: 110px !important; }
    .greeting-cell  { padding: 0 20px 8px 20px !important; }
    .greeting-text  { font-size: 20px !important; line-height: 1.35 !important; }
    .body-cell      { padding: 2px 20px 16px 20px !important; }
    .body-text      { font-size: 14px !important; }
    .proof-cell     { padding: 0 20px 24px 20px !important; }
    .hr-cell        { padding: 0 20px !important; }
    .social-cell    { padding: 16px 20px 8px 20px !important; }
    .footer-cell    { padding: 8px 20px 32px 20px !important; }
    .footer-text    { font-size: 11px !important; line-height: 1.6 !important; }
  }

  /* 다크 모드 대응 (iOS Mail / Apple Mail) */
  @media (prefers-color-scheme: dark) {
    .bg-body     { background-color: #ffffff !important; } /* 메일 배경은 밝게 고정 (브랜드 톤) */
    .text-dark   { color: #3c3c3c !important; }
    .text-muted  { color: #8f8f8f !important; }
    .text-brand  { color: #4b4b4b !important; }
  }
</style>
</head>
<body class="bg-body" style="margin:0; padding:0; width:100%; background-color:#ffffff; font-family:-apple-system,'Segoe UI','Apple SD Gothic Neo','Noto Sans KR','Noto Sans JP','Noto Sans SC','Helvetica Neue',sans-serif;">

<!-- 프리헤더 (받은편지함 미리보기 텍스트) -->
<div style="display:none; font-size:1px; color:#ffffff; line-height:1px; max-height:0px; max-width:0px; opacity:0; overflow:hidden;">
  {{greeting}} — {{body}}
</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#ffffff; padding:16px 0;">
<tr>
<td align="center" valign="top" style="padding:0;">

<table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%; max-width:600px; background-color:#ffffff;">

  <!-- 브랜드명 -->
  <tr>
    <td class="brand-cell text-brand" style="padding:40px 40px 24px 40px; text-align:center;">
      <span style="font-size:21px; font-weight:700; color:#4b4b4b; letter-spacing:0.5px;">{{brand_name}}</span>
    </td>
  </tr>

  <!-- CTA 버튼 -->
  <tr>
    <td class="cta-cell" style="padding:0 80px 40px 80px; text-align:center;">
      <a class="cta-link" href="{{cta_url}}" target="_blank" style="display:block; background-color:#58CC02; color:#ffffff; font-size:16px; font-weight:700; padding:15px 0; border-radius:14px; text-decoration:none; text-align:center; mso-padding-alt:0;">
        {{cta_text}}
      </a>
    </td>
  </tr>

  <!-- 로고 이미지 -->
  <tr>
    <td class="logo-cell" style="text-align:center; padding:0 40px 24px 40px;">
      <img class="logo-img" src="{{hero_image_url}}" alt="{{brand_name}}" width="130" style="display:block; margin:0 auto; border:0; outline:none; text-decoration:none; border-radius:20px;">
    </td>
  </tr>

  <!-- greeting (헤드라인) -->
  <tr>
    <td class="greeting-cell text-dark" style="padding:0 40px 8px 40px; text-align:center;">
      <p class="greeting-text" style="font-size:23px; font-weight:800; color:#3c3c3c; margin:0; line-height:1.4;">
        {{greeting}}
      </p>
    </td>
  </tr>

  <!-- body (서브텍스트) -->
  <tr>
    <td class="body-cell text-muted" style="padding:2px 40px 20px 40px; text-align:center;">
      <p class="body-text" style="font-size:14px; font-weight:400; color:#8f8f8f; margin:0; line-height:1.6;">
        {{body}}
      </p>
    </td>
  </tr>

  <!-- 사회적 증거 (소셜 프루프) -->
  <tr>
    <td class="proof-cell" style="padding:0 40px 32px 40px; text-align:center;">
      <p style="display:inline-block; font-size:12px; font-weight:600; color:#8f8f8f; margin:0; padding:6px 14px; background:#f7f7f7; border-radius:12px; line-height:1.4;">
        {{social_proof}}
      </p>
    </td>
  </tr>

  <!-- 구분선 -->
  <tr>
    <td class="hr-cell" style="padding:0 40px;">
      <hr style="border:none; border-top:1px solid #ebebeb; margin:0;">
    </td>
  </tr>

  <!-- 소셜 미디어 아이콘 (Instagram · TikTok · YouTube) -->
  <tr>
    <td class="social-cell" style="padding:24px 40px 8px 40px; text-align:center;">
      <a href="{{social_instagram}}" target="_blank" style="text-decoration:none; margin:0 8px; display:inline-block; vertical-align:middle;">
        <img src="https://evljahialeytwjpnjywm.supabase.co/storage/v1/object/public/email-assets/icon_instagram.png" alt="Instagram" width="22" height="22" style="display:block; border:0;">
      </a>
      <a href="{{social_tiktok}}" target="_blank" style="text-decoration:none; margin:0 8px; display:inline-block; vertical-align:middle;">
        <img src="https://evljahialeytwjpnjywm.supabase.co/storage/v1/object/public/email-assets/icon_tiktok.png" alt="TikTok" width="22" height="22" style="display:block; border:0;">
      </a>
      <a href="{{social_youtube}}" target="_blank" style="text-decoration:none; margin:0 8px; display:inline-block; vertical-align:middle;">
        <img src="https://evljahialeytwjpnjywm.supabase.co/storage/v1/object/public/email-assets/icon_youtube.png" alt="YouTube" width="22" height="22" style="display:block; border:0;">
      </a>
    </td>
  </tr>

  <!-- 문의 -->
  <tr>
    <td class="footer-cell" style="padding:12px 40px 0 40px; text-align:center;">
      <p class="footer-text" style="font-size:12px; font-weight:400; color:#8f8f8f; margin:0; line-height:1.6;">
        문의: <a href="mailto:{{support_email}}" style="color:#8f8f8f; text-decoration:underline;">{{support_email}}</a>
      </p>
    </td>
  </tr>

  <!-- 사업자 정보 (법적 필수) -->
  <tr>
    <td class="footer-cell" style="padding:16px 40px 8px 40px; text-align:center;">
      <p class="footer-text" style="font-size:11px; font-weight:400; color:#afafaf; margin:0; line-height:1.7;">
        {{business_company}} · 대표 {{business_ceo}} · 사업자등록번호 {{business_number}}<br>
        {{business_address}}
      </p>
    </td>
  </tr>

  <!-- 수신거부 + 저작권 -->
  <tr>
    <td class="footer-cell" style="padding:8px 40px 40px 40px; text-align:center;">
      <p class="footer-text" style="font-size:11px; font-weight:400; color:#afafaf; margin:0 0 6px 0; line-height:1.7;">
        {{unsubscribe_notice}}
      </p>
      <a href="{{unsubscribe_url}}" target="_blank" style="font-size:11px; font-weight:400; color:#afafaf; text-decoration:underline;">
        {{unsubscribe_text}}
      </a>
      <p class="footer-text" style="font-size:11px; font-weight:400; color:#c4c4c4; margin:10px 0 0 0; line-height:1.7;">
        © 2026 {{business_company}}. All rights reserved.
      </p>
    </td>
  </tr>

</table>

</td>
</tr>
</table>

</body>
</html>`;

export function renderTemplate(params: TemplateParams): string {
  let html = TEMPLATE;
  html = html.replaceAll("{{brand_name}}", params.brand_name);
  html = html.replaceAll("{{greeting}}", params.greeting);
  html = html.replaceAll("{{body}}", params.body);
  html = html.replaceAll("{{cta_text}}", params.cta_text);
  html = html.replaceAll("{{cta_url}}", params.cta_url);
  html = html.replaceAll("{{hero_image_url}}", params.hero_image_url);
  html = html.replaceAll("{{streak_count}}", String(params.streak_count));
  html = html.replaceAll("{{unsubscribe_url}}", params.unsubscribe_url);
  html = html.replaceAll("{{unsubscribe_notice}}", params.unsubscribe_notice);
  html = html.replaceAll("{{unsubscribe_text}}", params.unsubscribe_text);
  html = html.replaceAll("{{social_instagram}}", params.social_instagram);
  html = html.replaceAll("{{social_tiktok}}", params.social_tiktok);
  html = html.replaceAll("{{social_youtube}}", params.social_youtube);
  html = html.replaceAll("{{support_email}}", params.support_email);
  html = html.replaceAll("{{business_company}}", params.business_company);
  html = html.replaceAll("{{business_ceo}}", params.business_ceo);
  html = html.replaceAll("{{business_number}}", params.business_number);
  html = html.replaceAll("{{business_address}}", params.business_address);
  html = html.replaceAll("{{social_proof}}", params.social_proof);
  return html;
}

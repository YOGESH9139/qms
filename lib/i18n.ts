// Minimal English / Hindi strings for customer + kiosk screens.

export type Lang = "en" | "hi";

const STR = {
  welcome: { en: "Welcome to Sample Demo Bank", hi: "सैंपल डेमो बैंक में आपका स्वागत है" },
  chooseService: { en: "What would you like to do today?", hi: "आज आप क्या करना चाहेंगे?" },
  quick: { en: "Quick services", hi: "त्वरित सेवाएं" },
  standard: { en: "Standard services", hi: "सामान्य सेवाएं" },
  complex: { en: "Accounts, loans & more", hi: "खाता, लोन और अन्य" },
  mobileOptional: { en: "Mobile number (optional — we'll SMS your turn)", hi: "मोबाइल नंबर (वैकल्पिक — बारी आने पर SMS)" },
  priority: { en: "Priority (verified by greeter)", hi: "प्राथमिकता (ग्रीटर द्वारा सत्यापित)" },
  senior: { en: "Senior citizen", hi: "वरिष्ठ नागरिक" },
  disabled: { en: "Differently abled", hi: "दिव्यांग" },
  pregnant: { en: "Pregnant", hi: "गर्भवती" },
  getToken: { en: "Get my token", hi: "टोकन लें" },
  back: { en: "Back", hi: "वापस" },
  yourToken: { en: "Your token", hi: "आपका टोकन" },
  estWait: { en: "Estimated wait", hi: "अनुमानित प्रतीक्षा" },
  smsSent: { en: "SMS sent to your phone", hi: "आपके फ़ोन पर SMS भेजा गया" },
  watchScreen: { en: "Watch the screen — your counter number appears when you're called.", hi: "स्क्रीन देखें — बुलाए जाने पर काउंटर नंबर दिखेगा।" },
  print: { en: "Print slip", hi: "पर्ची प्रिंट करें" },
  done: { en: "Done", hi: "हो गया" },
  haveAppt: { en: "I have an appointment", hi: "मेरी अपॉइंटमेंट है" },
  checkIn: { en: "Check in", hi: "चेक इन" },
  enterMobile: { en: "Enter your mobile number or booking code", hi: "मोबाइल नंबर या बुकिंग कोड दर्ज करें" },
  noAppNeeded: { en: "No app needed — everyone is welcome.", hi: "ऐप की ज़रूरत नहीं — सभी का स्वागत है।" },
  hello: { en: "Hi! I'm your branch assistant.", hi: "नमस्ते! मैं आपका शाखा सहायक हूँ।" },
  yourName: { en: "Your name", hi: "आपका नाम" },
  mobile: { en: "Mobile number", hi: "मोबाइल नंबर" },
  otp: { en: "OTP (demo: 1234)", hi: "ओटीपी (डेमो: 1234)" },
  continue: { en: "Continue", hi: "आगे बढ़ें" },
  whatHelp: { en: "What do you need help with today?", hi: "आज आपको किस चीज़ में मदद चाहिए?" },
  somethingElse: { en: "Something else", hi: "कुछ और" },
  other: { en: "Other (type)", hi: "अन्य (लिखें)" },
  typeHere: { en: "Type here…", hi: "यहाँ लिखें…" },
  send: { en: "Send", hi: "भेजें" },
  yourPlan: { en: "Your plan", hi: "आपकी योजना" },
  onlineTitle: { en: "Can this be done online?", hi: "क्या यह ऑनलाइन हो सकता है?" },
  saveTrip: { en: "Save a trip — do it in", hi: "यात्रा बचाएं — करें" },
  openApp: { en: "Do it online now", hi: "अभी ऑनलाइन करें" },
  documents: { en: "Documents checklist", hi: "दस्तावेज़ सूची" },
  tips: { en: "Before you visit", hi: "आने से पहले" },
  visitOptions: { en: "Visit options", hi: "आने के विकल्प" },
  book: { en: "Book appointment", hi: "अपॉइंटमेंट बुक करें" },
  walkIn: { en: "Get a walk-in token now", hi: "अभी वॉक-इन टोकन लें" },
  atBranch: { en: "I'm at / near the branch", hi: "मैं शाखा पर / पास हूँ" },
  runningLate: { en: "I'm running late (10 min)", hi: "मैं 10 मिनट देर से आऊँगा" },
  cancel: { en: "Cancel", hi: "रद्द करें" },
  position: { en: "Position in line", hi: "कतार में स्थान" },
  goTo: { en: "Please go to", hi: "कृपया जाएं" },
  counter: { en: "Counter", hi: "काउंटर" },
  rate: { en: "How was your visit?", hi: "आपका अनुभव कैसा रहा?" },
  submit: { en: "Submit", hi: "जमा करें" },
  thanks: { en: "Thank you!", hi: "धन्यवाद!" },
} as const;

export type StrKey = keyof typeof STR;

export function t(key: StrKey, lang: Lang): string {
  return STR[key][lang];
}

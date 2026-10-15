/**
 * T09 Subtitle Generator's languages: the setting's choices and what the
 * prompt calls each one. Its own small module, so the tool's page can list
 * them without loading the caption code (docs/10 → script budget).
 */

export interface CaptionLanguage {
  value: string;
  label: string;
  /** As the prompt names it. */
  name: string;
  script?: 'latin' | 'cyrillic';
}

/** The languages offered by name, Uzbek's two scripts first; "auto" lets Gemini tell. */
export const CAPTION_LANGUAGES: readonly CaptionLanguage[] = [
  { value: 'uz', label: 'Uzbek (Latin)', name: 'Uzbek', script: 'latin' },
  { value: 'uz-cyrl', label: 'Uzbek (Cyrillic)', name: 'Uzbek', script: 'cyrillic' },
  { value: 'ru', label: 'Russian', name: 'Russian' },
  { value: 'en', label: 'English', name: 'English' },
  { value: 'kk', label: 'Kazakh', name: 'Kazakh' },
  { value: 'ky', label: 'Kyrgyz', name: 'Kyrgyz' },
  { value: 'tg', label: 'Tajik', name: 'Tajik' },
  { value: 'tk', label: 'Turkmen', name: 'Turkmen' },
  { value: 'kaa', label: 'Karakalpak', name: 'Karakalpak' },
  { value: 'tr', label: 'Turkish', name: 'Turkish' },
  { value: 'ar', label: 'Arabic', name: 'Arabic' },
  { value: 'fa', label: 'Persian', name: 'Persian' },
  { value: 'de', label: 'German', name: 'German' },
  { value: 'es', label: 'Spanish', name: 'Spanish' },
  { value: 'fr', label: 'French', name: 'French' },
  { value: 'it', label: 'Italian', name: 'Italian' },
  { value: 'pt', label: 'Portuguese', name: 'Portuguese' },
  { value: 'hi', label: 'Hindi', name: 'Hindi' },
  { value: 'ko', label: 'Korean', name: 'Korean' },
  { value: 'ja', label: 'Japanese', name: 'Japanese' },
  { value: 'zh', label: 'Chinese', name: 'Chinese' },
];

/** The language a setting names, or null for "auto" (and anything unknown). */
export function captionLanguage(value: string | undefined): CaptionLanguage | null {
  return CAPTION_LANGUAGES.find((language) => language.value === value) ?? null;
}

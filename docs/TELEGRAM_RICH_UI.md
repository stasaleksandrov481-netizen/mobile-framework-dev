# Native Telegram Rich UI

Production uses `InputRichMessage.markdown` and documented `<tg-button>` controls in paragraphs and `<tg-button-row>` for primary actions. No inline keyboard is attached to successful rich sends. Tables, details, footer, custom emoji and welcome media are native rich blocks. The normal keyboard is retained only on definite provider rejection. Existing signed webhook and payment handlers are unchanged.

Reference: https://core.telegram.org/bots/api#rich-message-formatting-options

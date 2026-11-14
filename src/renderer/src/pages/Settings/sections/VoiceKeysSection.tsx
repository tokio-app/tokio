import { APP_EVENTS, APP_EVENTS_RESPONSE, VoiceEngine } from "@/common/types";
import { Btn, Field, FormGrid, Input, Section } from "@/components";
import { useAutosave, useIpcListener, useIpcRequest, useMenu } from "@/hooks";
import { useT } from "@/ui/i18n";
import { cx } from "@/helper";
import { useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { FiKey, FiPlus, FiTrash2 } from "react-icons/fi";
import styles from "../settings.module.css";

type EngineKey = VoiceEngine & { key: string };

// Keys for the voice engines that take one. Hidden when none does. The first,
// TikTok's session ID, always shows; the others once they have a key or are
// added from the menu, so no field sits empty (the user's call). One shown
// stays until it's removed, so clearing a key to paste another keeps its field.
export function VoiceKeysSection() {
  const t = useT();
  const menu = useMenu();
  const [engines, setEngines] = useState<EngineKey[]>([]);
  // The engines past the first that show, by id
  const [visible, setVisible] = useState<string[]>([]);
  // The menu opens over its button when the window has no room under it,
  // as the section can sit at its bottom
  const menuEl = useRef<HTMLDivElement>(null);
  const [up, setUp] = useState(false);

  useLayoutEffect(() => {
    const rect = menuEl.current?.getBoundingClientRect();
    if (!rect) return undefined;
    const button = menu.toggleRef.current?.getBoundingClientRect();
    const room = (button?.top ?? 0) - rect.height;
    if (rect.bottom > window.innerHeight && room > 0) setUp(true);
    return () => setUp(false);
  }, [menu.open, menu.toggleRef]);

  useIpcRequest(APP_EVENTS.GET_VOICE_KEYS);

  useIpcListener(APP_EVENTS_RESPONSE.GET_VOICE_KEYS, (res) => {
    if (!res?.success) return;
    setEngines(res.engines!);
    const keyed = res.engines!.filter((e) => e.key !== "").map((e) => e.id);
    setVisible((list) => [...new Set([...list, ...keyed])]);
  });

  if (engines.length === 0) return null;

  const [first, ...others] = engines;
  const shown = others.filter((e) => visible.includes(e.id));
  const addable = others.filter((e) => !visible.includes(e.id));
  const add = t("settings.voiceKeys.add");

  // The focus goes to the menu's button, as the one removing leaves
  const remove = (id: string) => {
    flushSync(() => setVisible((list) => list.filter((v) => v !== id)));
    menu.toggleRef.current?.focus();
  };

  return (
    <Section
      icon={<FiKey />}
      title={t("settings.voiceKeys.title")}
      description={t("settings.voiceKeys.description")}
      actions={
        addable.length > 0 && (
          <div
            className={styles.menu_anchor}
            ref={menu.ref}
            onKeyDown={menu.onKeyDown}
          >
            <Btn
              ref={menu.toggleRef}
              variant="icon"
              title={add}
              aria-label={add}
              aria-haspopup="menu"
              aria-expanded={menu.open}
              onClick={menu.toggle}
            >
              <FiPlus size={20} />
            </Btn>
            {menu.open && (
              <div
                ref={menuEl}
                className={cx(styles.menu, up && styles.menu_up)}
                role="menu"
                aria-label={add}
              >
                {addable.map((engine) => (
                  <button
                    key={engine.id}
                    type="button"
                    role="menuitem"
                    className={styles.menu_item}
                    onClick={() => {
                      menu.close();
                      setVisible((list) => [...list, engine.id]);
                    }}
                  >
                    {engine.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )
      }
    >
      <FormGrid>
        <KeyForm engine={first} />
        {shown.map((engine) => (
          <KeyForm
            key={engine.id}
            engine={engine}
            // Its field takes the focus when it's added
            focus={engine.key === ""}
            onRemove={() => remove(engine.id)}
          />
        ))}
      </FormGrid>
    </Section>
  );
}

type KeyFormProps = {
  engine: EngineKey;
  focus?: boolean;
  // Set for an engine that can be taken off the list, its key with it
  onRemove?: () => void;
};

// Saved as it changes; an empty key removes the saved one
function KeyForm({ engine, focus, onRemove }: KeyFormProps) {
  const t = useT();
  // Only engines with one are listed
  const keyLabel = engine.keyLabel ? t(engine.keyLabel) : "";
  const [key, setKey, flush] = useAutosave(engine.key, (value) =>
    window.api.emit(APP_EVENTS.SET_VOICE_KEY, {
      engine: engine.id,
      key: value,
    }),
  );
  const remove = t("settings.voiceKeys.remove", { engine: engine.label });

  return (
    <div className={styles.provider}>
      <Field
        label={t("settings.voiceKeys.label", { engine: engine.label })}
        hint={t("settings.voiceKeys.hint", { key: keyLabel })}
      >
        <div className={styles.key}>
          <Input
            type="password"
            placeholder={t("settings.voiceKeys.placeholder", {
              engine: engine.label,
              key: keyLabel,
            })}
            autoFocus={focus}
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
          {onRemove && (
            <Btn
              variant="icon"
              title={remove}
              aria-label={remove}
              onClick={() => {
                // A change still waiting goes first, so the empty key is last
                flush();
                window.api.emit(APP_EVENTS.SET_VOICE_KEY, {
                  engine: engine.id,
                  key: "",
                });
                onRemove();
              }}
            >
              <FiTrash2 size={20} />
            </Btn>
          )}
        </div>
      </Field>
    </div>
  );
}

import {
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

export function SettingsGroup({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("space-y-4", className)}>
      <div>
        <h4 className="text-sm font-semibold">{title}</h4>
        {description && (
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      <div className="rounded-xl border bg-background/40 px-4 sm:px-5 [&>*+*]:border-t [&>*+*]:border-border [&>*]:py-4">
        {children}
      </div>
    </section>
  );
}

export function SettingsToggle({
  label,
  description,
  checked,
  onChange,
  disabled,
  badge,
}: {
  label: string;
  description?: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  badge?: ReactNode;
}) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-5">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <label
            htmlFor={id}
            className={cn(
              "cursor-pointer text-sm font-medium",
              disabled && "text-muted-foreground",
            )}
          >
            {label}
          </label>
          {badge}
        </div>
        {description && (
          <p
            id={`${id}-help`}
            className="mt-1.5 max-w-xl text-sm leading-relaxed text-muted-foreground"
          >
            {description}
          </p>
        )}
      </div>
      <Switch
        id={id}
        aria-describedby={description ? `${id}-help` : undefined}
        className="mt-0.5 shrink-0 data-[state=checked]:bg-amber-500"
        checked={checked}
        onCheckedChange={onChange}
        disabled={disabled}
      />
    </div>
  );
}

export function SettingsField({
  label,
  description,
  children,
  htmlFor,
}: {
  label: string;
  description?: ReactNode;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="grid min-w-0 items-start gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(160px,240px)] sm:gap-6">
      <div className="min-w-0">
        <label htmlFor={htmlFor} className="text-sm font-medium">
          {label}
        </label>
        {description && (
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function SettingsAddressList({
  label,
  description,
  values,
  onChange,
}: {
  label: string;
  description: string;
  values: string[];
  onChange: (values: string[]) => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState(values.join(", "));
  const parse = (value: string) =>
    value
      .split(",")
      .map((address) => address.trim())
      .filter(Boolean);
  useEffect(() => {
    setDraft((current) =>
      parse(current).join(", ") === values.join(", ")
        ? current
        : values.join(", "),
    );
  }, [values]);
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <p
        id={`${id}-help`}
        className="text-sm leading-relaxed text-muted-foreground"
      >
        {description}
      </p>
      <Input
        id={id}
        aria-describedby={`${id}-help`}
        inputMode="email"
        value={draft}
        placeholder="name@company.com, colleague@company.com"
        onChange={(event) => {
          setDraft(event.target.value);
          onChange(parse(event.target.value));
        }}
        onBlur={() => setDraft(parse(draft).join(", "))}
      />
    </div>
  );
}

export function SettingsNumberInput({
  value,
  onChange,
  min = 0,
  allowEmpty = false,
  ...props
}: Omit<ComponentProps<typeof Input>, "value" | "onChange" | "min"> & {
  value: number | null;
  onChange: (value: number | null) => void;
  min?: number;
  allowEmpty?: boolean;
}) {
  const [draft, setDraft] = useState(value === null ? "" : String(value));
  const committedValue = useRef(value);
  useEffect(() => {
    if (value !== committedValue.current) {
      committedValue.current = value;
      setDraft(value === null ? "" : String(value));
    }
  }, [value]);
  const commit = (text: string) => {
    const number = Number(text);
    if (!text && allowEmpty) {
      committedValue.current = null;
      onChange(null);
      return true;
    }
    if (text && Number.isInteger(number) && number >= min) {
      committedValue.current = number;
      onChange(number);
      return true;
    }
    return false;
  };
  return (
    <Input
      {...props}
      type="number"
      min={min}
      step={1}
      inputMode="numeric"
      value={draft}
      onChange={(event) => {
        setDraft(event.target.value);
        commit(event.target.value);
      }}
      onBlur={() => {
        if (!commit(draft)) setDraft(value === null ? "" : String(value));
      }}
    />
  );
}

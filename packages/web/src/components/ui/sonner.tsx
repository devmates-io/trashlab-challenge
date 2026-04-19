import { Toaster as Sonner } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

// Light-only theme per OQ-5 → keep theme fixed at "light".
const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="light"
      className="toaster group"
      // Error toasts use `duration: Infinity` per the §6.6.8 "Error (4xx) —
      // manual dismiss" spec. Without a visible close control they become
      // un-dismissible, so expose the built-in close button globally.
      closeButton
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton:
            "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
          // Sonner ships the close `x` on the top-left by default. Move it to
          // the top-right so it reads as a standard dismiss affordance. `!` is
          // required to beat sonner's inline left/translate rules (see
          // https://sonner.emilkowal.ski/styling).
          closeButton:
            "!left-auto !right-0 !translate-x-1/2 !-translate-y-1/2",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };

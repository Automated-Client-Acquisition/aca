import { Dialog, DialogContent, DialogClose } from "@/components/ui/dialog";
import { X, ZoomIn } from "lucide-react";

interface LightboxProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    src: string | null;
    alt?: string;
}

export function Lightbox({ open, onOpenChange, src, alt }: LightboxProps) {
    if (!src) return null;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-[90vw] max-h-[90vh] p-0 overflow-hidden bg-transparent border-none shadow-none flex items-center justify-center">
                <div className="relative w-full h-full flex items-center justify-center">
                    <img
                        src={src}
                        alt={alt || "Full screen preview"}
                        className="max-w-full max-h-[85vh] object-contain rounded-md shadow-2xl"
                    />
                    <DialogClose className="absolute top-4 right-4 z-50 rounded-full bg-black/50 p-2 text-white hover:bg-black/70 transition-colors focus:outline-none">
                        <X className="h-6 w-6" />
                        <span className="sr-only">Close</span>
                    </DialogClose>
                </div>
            </DialogContent>
        </Dialog>
    );
}

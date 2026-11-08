import type { SemanticIssue } from '@mythos/contracts';
import { CircleAlertIcon } from 'lucide-react';
import { useSaveSettings } from '@/api/settings';
import { FailureMessage } from '@/components/failure-message';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { defaultMachineConfig } from './default-config';

/**
 * Machine config that failed to load: every issue with its path, and a way to start
 * again from the default settings, after asking. The server saves over a broken file,
 * so the owner fixes the config in Settings on the host (01-architecture Decisions).
 * Implements PRV-001's default, as the first start writes it.
 */
export function BrokenConfig({
  issues,
  onSaved,
}: {
  issues: readonly SemanticIssue[];
  onSaved: (restartRequired: boolean) => void;
}) {
  const save = useSaveSettings();
  return (
    <div className="grid gap-4">
      <div
        role="alert"
        className="grid gap-3 rounded-lg border border-l-4 border-l-negative bg-surface p-4"
      >
        <h2 className="flex items-center gap-2 font-display text-xl">
          <CircleAlertIcon aria-hidden className="size-5 shrink-0 text-negative" />
          The settings file has problems
        </h2>
        <p>
          Mythos couldn&apos;t load machine-config.json, the settings file in its data folder. Fix
          each problem below in the file and restart Mythos, or start again from the default
          settings.
        </p>
        <ul className="grid gap-1 text-sm">
          {issues.map((issue, index) => (
            <li key={`${issue.path}-${String(index)}`}>
              <span className="font-medium">
                {issue.path === '' ? 'The whole file' : issue.path}:
              </span>{' '}
              {issue.message}
            </li>
          ))}
        </ul>
      </div>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button className="justify-self-start" disabled={save.isPending}>
            Start from default settings
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Start from default settings?</AlertDialogTitle>
            <AlertDialogDescription>
              This replaces machine-config.json with the default settings. Everything in it is lost,
              stored API keys included.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep the file</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                save.mutate(defaultMachineConfig(), {
                  onSuccess: (result) => {
                    onSaved(result.restartRequired);
                  },
                });
              }}
            >
              Replace it
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {save.isError && <FailureMessage error={save.error} />}
    </div>
  );
}

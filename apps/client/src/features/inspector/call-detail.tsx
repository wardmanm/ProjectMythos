import { useModelCall } from '@/api/model-calls';
import { FailureMessage } from '@/components/failure-message';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { roleWords } from './call-words';
import { OutputTab } from './output-tab';
import { PromptTab } from './prompt-tab';

/** The inspector's tabs in phase 1; Memories and Templates arrive later (14-ui §15). */
export const INSPECTOR_TABS = ['prompt', 'output'] as const;
export type InspectorTab = (typeof INSPECTOR_TABS)[number];

type CallDetailProps = {
  campaignId: string;
  callId: string;
  tab: InspectorTab;
  onTabChange: (tab: InspectorTab) => void;
};

/**
 * One model call, chosen from the list, in its Prompt and Output tabs (UI-090). The open
 * tab is in the address, so a refresh keeps it (UI-001).
 */
export function CallDetail({ campaignId, callId, tab, onTabChange }: CallDetailProps) {
  const call = useModelCall(campaignId, callId);
  if (call.isPending) return <p className="text-text-muted">Opening the call…</p>;
  if (call.isError) return <FailureMessage error={call.error} />;
  const record = call.data;
  return (
    <section aria-labelledby="call-heading" className="flex min-w-0 flex-col gap-3">
      <h2 id="call-heading" className="font-display text-xl wrap-anywhere">
        {roleWords[record.role]} call to {record.model}
      </h2>
      <Tabs
        value={tab}
        onValueChange={(value) => {
          const chosen = INSPECTOR_TABS.find((each) => each === value);
          if (chosen !== undefined) onTabChange(chosen);
        }}
        className="min-w-0"
      >
        <TabsList>
          <TabsTrigger value="prompt" className="px-4">
            Prompt
          </TabsTrigger>
          <TabsTrigger value="output" className="px-4">
            Output
          </TabsTrigger>
        </TabsList>
        <TabsContent value="prompt" className="min-w-0 pt-3 text-base">
          <PromptTab record={record} />
        </TabsContent>
        <TabsContent value="output" className="min-w-0 pt-3 text-base">
          <OutputTab record={record} />
        </TabsContent>
      </Tabs>
    </section>
  );
}

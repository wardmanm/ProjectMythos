{{#if turns}}
## The story so far

{{#each turns}}
{{#if input}}
Player: {{input}}

{{/if}}
{{narration}}

{{/each}}
{{/if}}

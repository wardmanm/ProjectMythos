## The player's character: {{name}}

{{#if personality}}
{{personality}}

{{/if}}
Stats, from {{statMin}} to {{statMax}}:
{{#each stats}}
- {{name}}: {{rating}}
{{/each}}

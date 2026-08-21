import { defineRule } from "@oxlint/plugins";

import type { ESTree, Scope } from "@oxlint/plugins";

type RuntimeFunction = ESTree.ArrowFunctionExpression | ESTree.Function;

function isRuntimeFunction(node: ESTree.Node): node is RuntimeFunction {
	return (
		node.type === "ArrowFunctionExpression" ||
		node.type === "FunctionDeclaration" ||
		node.type === "FunctionExpression"
	);
}

function isInsideTypeGuard(node: ESTree.Node): boolean {
	let current: ESTree.Node | null = node.parent;
	while (current !== null && current.type !== "Program") {
		if (isRuntimeFunction(current)) {
			return current.returnType?.typeAnnotation.type === "TSTypePredicate";
		}
		current = current.parent;
	}
	return false;
}

// LOCAL AMENDMENT (miles-mccrocklin): `typeof window === 'undefined'` is
// not narrowing a value, it is asking whether a global exists at all —
// the standard SSR / capability probe, and the only expression that can
// ask without throwing a ReferenceError. Allowed when the operand is a
// bare identifier with no binding anywhere in the file's scope chain,
// which is exactly the free-global case; `typeof someLocal` still
// reports.
function isFreeGlobalProbe(
	node: ESTree.UnaryExpression,
	context: { sourceCode: { getScope: (node: ESTree.Node) => Scope | null } },
): boolean {
	if (node.argument.type !== "Identifier") return false;
	const name = node.argument.name;
	let scope: Scope | null = context.sourceCode.getScope(node);
	while (scope !== null) {
		if (scope.set.has(name)) return false;
		scope = scope.upper;
	}
	return true;
}

/** Disallow runtime typeof checks that narrow unparsed values instead of decoding them. */
export const noRuntimeTypeofRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				"Disallow runtime typeof checks; external values must be decoded into meaningful types at their I/O boundary.",
		},
		messages: {
			runtimeTypeof:
				"A `typeof` check narrows a representation without establishing its contract. Parse input at its I/O boundary, then branch on the domain value.",
		},
		schema: [
			{
				type: "object",
				properties: {
					allowInTypeGuards: { type: "boolean" },
				},
				additionalProperties: false,
			},
		],
		defaultOptions: [{ allowInTypeGuards: false }],
	},
	createOnce(context) {
		return {
			UnaryExpression(node) {
				const option = context.options?.[0];
				const allowInTypeGuards =
					typeof option === "object" &&
					option !== null &&
					!Array.isArray(option) &&
					option.allowInTypeGuards === true;
				if (
					node.operator === "typeof" &&
					(!allowInTypeGuards || !isInsideTypeGuard(node)) &&
					!isFreeGlobalProbe(node, context)
				) {
					context.report({ node, messageId: "runtimeTypeof" });
				}
			},
		};
	},
});

# Java Javadoc Mandatory Rules

Apply these rules automatically whenever editing a `.java` file, adding or refactoring a method, adding an interface or abstract method, generating documentation through `/doc`, or completing Java code with AI.

## Required workflow

1. Before finishing a Java change, scan every method in each touched class or interface for missing Javadoc.
2. Add compliant Javadoc to every undocumented method in the touched type, including public, protected, package-private, private, static, interface, abstract, and default methods. Do not limit the scan to newly added methods.
3. Update existing Javadoc when a refactor changes parameters, return semantics, exceptions, side effects, constraints, or business behavior.
4. Keep comments specific to the implementation contract. Do not add empty, tautological, copied, or misleading text merely to satisfy the format.
5. Preserve generated-code boundaries. Do not edit generated Java sources; document the owning source/schema or exclude the generated directory with a recorded reason.

## Mandatory method template

Use valid standard Javadoc syntax. Do not prefix prose or tags with Markdown list markers.

```java
/**
 * 【方法中文功能简述】一句话说明该方法的核心业务作用。
 *
 * <p>详细说明：复杂逻辑、业务场景、特殊限制、副作用和异常场景。
 * 简单方法可以省略本段。</p>
 *
 * @param parameterName 参数含义、入参约束以及允许或不允许的值
 * @return 返回值的业务含义；返回类型为 void 时省略此标签
 * @throws ExceptionType 抛出该异常的明确触发条件
 * @author Developer Name
 * @date yyyy-MM-dd
 */
```

## Tag rules

- Write the opening Chinese summary for every method and describe the business purpose, not merely the Java operation.
- Add one `@param` for every declared parameter, in declaration order. State meaning, nullability, range, format, allowed values, and other meaningful constraints.
- Add `@return` for every non-`void` method. Explain semantics, nullability, collection contents, empty-result behavior, or status meaning where relevant. Omit it only for `void`.
- Add `@throws` for every checked exception and every explicitly declared or intentionally propagated business/runtime exception whose trigger is part of the method contract. Do not invent exceptions that the method cannot throw.
- Resolve `@author` from the repository/team convention or configured developer identity (for example `git config user.name`). Do not invent a personal name. If no identity is available, use the project-approved generic author; otherwise request it before finalizing a persistent team artifact.
- Set `@date` to the actual creation/update date in `yyyy-MM-dd` format. When materially changing a method contract, refresh the date according to the repository convention.
- For overridden methods, use `{@inheritDoc}` only when the inherited documentation fully describes the implementation contract. Add implementation-specific constraints, side effects, or exceptions when they differ.
- For getters, setters, constructors, record accessors, and trivial delegation methods, keep the description concise but still provide all applicable mandatory tags unless the repository explicitly excludes generated/boilerplate methods.

## Completion check

Do not report a Java task complete until every touched Java type has been scanned, all methods have compliant Javadoc, tag names match actual parameters and exceptions, non-`void` methods have `@return`, `void` methods do not, and compilation/Javadoc validation has been run where available.

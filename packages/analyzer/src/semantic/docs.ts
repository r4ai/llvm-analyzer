/**
 * Hover や補完で使う短いドキュメント項目。
 *
 * @remarks
 * `label` は補完候補や hover 見出しに出す短い名前。
 * `markdown` は LSP の MarkupContent へ渡す本文として使う。
 *
 * @public
 */
export interface DocEntry {
  /** 表示名。LLVM IR 上のキーワードやオペコードをそのまま保持する。 */
  readonly label: string;
  /** ユーザーへ表示する説明文。 */
  readonly markdown: string;
}

interface DocMarkdownOptions {
  readonly summary: string;
  readonly usage: string;
  readonly pseudo: string;
  readonly example: string;
  readonly reference: string;
}

const langRef = (anchor: string): string => `https://llvm.org/docs/LangRef.html#${anchor}`;

const docMarkdown = ({ summary, usage, pseudo, example, reference }: DocMarkdownOptions): string =>
  [
    summary,
    "",
    usage,
    "",
    "Example:",
    "```llvm",
    `; ${pseudo}`,
    example,
    "```",
    "",
    `[LLVM LangRef](${reference})`,
  ].join("\n");

/**
 * よく使う LLVM IR オペコードのドキュメント辞書。
 *
 * @remarks
 * 初期実装では、hover と completion の品質に効く代表的な命令だけを持つ。
 * 完全な仕様説明ではなく、エディタ上で短時間に意味を確認するための説明に絞る。
 *
 * @example
 * const doc = opcodeDocs.get("call");
 * doc?.markdown; // 関数呼び出しの説明
 *
 * @public
 */
export const opcodeDocs = new Map<string, DocEntry>([
  [
    "add",
    {
      label: "add",
      markdown: docMarkdown({
        summary: "Adds integer or integer vector values of the same type.",
        usage:
          "Use it for plain integer addition. Add `nuw` or `nsw` only when overflow is impossible under that rule.",
        pseudo: "sum = lhs + rhs",
        example: "%sum = add i32 %lhs, %rhs",
        reference: langRef("add-instruction"),
      }),
    },
  ],
  [
    "sub",
    {
      label: "sub",
      markdown: docMarkdown({
        summary: "Subtracts integer or integer vector values of the same type.",
        usage:
          "Use it for integer difference calculations. Overflow flags have the same care requirements as `add`.",
        pseudo: "diff = lhs - rhs",
        example: "%diff = sub i32 %lhs, %rhs",
        reference: langRef("sub-instruction"),
      }),
    },
  ],
  [
    "mul",
    {
      label: "mul",
      markdown: docMarkdown({
        summary: "Multiplies integer or integer vector values of the same type.",
        usage:
          "Use it for integer products. Prefer explicit overflow flags only when the IR producer can prove them.",
        pseudo: "product = lhs * rhs",
        example: "%product = mul i32 %lhs, %rhs",
        reference: langRef("mul-instruction"),
      }),
    },
  ],
  [
    "load",
    {
      label: "load",
      markdown: docMarkdown({
        summary: "Reads a typed value from memory through a pointer.",
        usage:
          "Use it when an SSA value must be materialized from an address. The result type is written before the pointer operand.",
        pseudo: "value = *addr",
        example: "%value = load i32, ptr %addr, align 4",
        reference: langRef("load-instruction"),
      }),
    },
  ],
  [
    "store",
    {
      label: "store",
      markdown: docMarkdown({
        summary: "Writes a value to memory through a pointer.",
        usage: "Use it for side effects. It does not produce an SSA result.",
        pseudo: "*addr = value",
        example: "store i32 %value, ptr %addr, align 4",
        reference: langRef("store-instruction"),
      }),
    },
  ],
  [
    "ptrtoaddr",
    {
      label: "ptrtoaddr",
      markdown: docMarkdown({
        summary: "Converts the address bits of a pointer to an integer.",
        usage:
          "Use it when only the address component is needed. It differs from pointer provenance and non-address bits.",
        pseudo: "addr = address_bits(p)",
        example: "%addr = ptrtoaddr ptr %p to i64",
        reference: langRef("ptrtoaddr-to-instruction"),
      }),
    },
  ],
  [
    "call",
    {
      label: "call",
      markdown: docMarkdown({
        summary: "Calls a function and uses its return value when present.",
        usage:
          "Use it for direct or indirect calls. The result is omitted when the callee returns `void`.",
        pseudo: "n = strlen(s)",
        example: "%n = call i32 @strlen(ptr %s)",
        reference: langRef("call-instruction"),
      }),
    },
  ],
  [
    "ret",
    {
      label: "ret",
      markdown: docMarkdown({
        summary: "Returns control from the current function.",
        usage:
          "Use `ret void` for void functions, or return one value whose type matches the function result.",
        pseudo: "return value",
        example: "ret i32 %value",
        reference: langRef("ret-instruction"),
      }),
    },
  ],
  [
    "br",
    {
      label: "br",
      markdown: docMarkdown({
        summary: "Transfers control to another basic block.",
        usage:
          "Use the one-label form for unconditional branches, or `i1` plus two labels for conditional branches.",
        pseudo: "jump = cond ? then : else",
        example: "br i1 %cond, label %then, label %else",
        reference: langRef("br-instruction"),
      }),
    },
  ],
  [
    "phi",
    {
      label: "phi",
      markdown: docMarkdown({
        summary: "Selects an SSA value based on the predecessor block.",
        usage:
          "Use it at the start of a basic block to merge values from incoming control-flow edges.",
        pseudo: "x = then ? a : b",
        example: "%x = phi i32 [ %a, %then ], [ %b, %else ]",
        reference: langRef("phi-instruction"),
      }),
    },
  ],
  [
    "alloca",
    {
      label: "alloca",
      markdown: docMarkdown({
        summary: "Allocates stack memory in the current function frame.",
        usage:
          "Use it to create an addressable local object. The result is a pointer to the allocated storage.",
        pseudo: "slot = stack_alloc(sizeof(i32))",
        example: "%slot = alloca i32, align 4",
        reference: langRef("alloca-instruction"),
      }),
    },
  ],
  [
    "switch",
    {
      label: "switch",
      markdown: docMarkdown({
        summary: "Branches to one of several labels based on an integer value.",
        usage: "Use it for multi-way control flow when a value is compared against constant cases.",
        pseudo: "jump = cases[value] ?? default",
        example: "switch i32 %x, label %default [ i32 0, label %zero ]",
        reference: langRef("switch-instruction"),
      }),
    },
  ],
  [
    "indirectbr",
    {
      label: "indirectbr",
      markdown: docMarkdown({
        summary: "Branches to a label address computed at runtime.",
        usage:
          "Use it for computed gotos and low-level control flow. The destination must be in the listed labels.",
        pseudo: "jump to *address",
        example: "indirectbr ptr %addr, [label %a, label %b]",
        reference: langRef("indirectbr-instruction"),
      }),
    },
  ],
  [
    "invoke",
    {
      label: "invoke",
      markdown: docMarkdown({
        summary: "Calls a function with separate normal and exceptional successors.",
        usage: "Use it for calls that may unwind through exception handling control flow.",
        pseudo: "result = callee(); success -> ok, unwind -> lpad",
        example: "%r = invoke i32 @f() to label %ok unwind label %lpad",
        reference: langRef("invoke-instruction"),
      }),
    },
  ],
  [
    "callbr",
    {
      label: "callbr",
      markdown: docMarkdown({
        summary: "Calls inline assembly or a callee that can branch to labels.",
        usage:
          "Use it for call-like operations with an ordinary fallthrough and indirect label destinations.",
        pseudo: "call target; jump may go to labels",
        example: 'callbr void asm sideeffect "", ""() to label %fallthrough [label %target]',
        reference: langRef("callbr-instruction"),
      }),
    },
  ],
  [
    "resume",
    {
      label: "resume",
      markdown: docMarkdown({
        summary: "Continues propagating an in-flight exception.",
        usage:
          "Use it in exception handling code after a landing pad decides not to catch the exception.",
        pseudo: "rethrow exception",
        example: "resume { ptr, i32 } %exn",
        reference: langRef("resume-instruction"),
      }),
    },
  ],
  [
    "catchswitch",
    {
      label: "catchswitch",
      markdown: docMarkdown({
        summary: "Dispatches an exception to one of several catch handlers.",
        usage: "Use it in Windows-style exception handling to select catch pads.",
        pseudo: "dispatch exception to catch handlers",
        example: "%cs = catchswitch within none [label %catch] unwind to caller",
        reference: langRef("catchswitch-instruction"),
      }),
    },
  ],
  [
    "catchret",
    {
      label: "catchret",
      markdown: docMarkdown({
        summary: "Exits a catch pad and transfers control to a normal label.",
        usage: "Use it as the terminator for a catch handler that resumes normal execution.",
        pseudo: "leave catch -> next",
        example: "catchret from %pad to label %next",
        reference: langRef("catchret-instruction"),
      }),
    },
  ],
  [
    "cleanupret",
    {
      label: "cleanupret",
      markdown: docMarkdown({
        summary: "Exits a cleanup pad, optionally unwinding further.",
        usage: "Use it as the terminator for cleanup code in exception handling.",
        pseudo: "leave cleanup",
        example: "cleanupret from %pad unwind to caller",
        reference: langRef("cleanupret-instruction"),
      }),
    },
  ],
  [
    "unreachable",
    {
      label: "unreachable",
      markdown: docMarkdown({
        summary: "Marks a control-flow point that must never execute.",
        usage:
          "Use it after calls that never return or paths proven impossible. Executing it is undefined behavior.",
        pseudo: "assert false",
        example: "unreachable",
        reference: langRef("unreachable-instruction"),
      }),
    },
  ],
  [
    "fneg",
    {
      label: "fneg",
      markdown: docMarkdown({
        summary: "Negates a floating-point value.",
        usage: "Use it for unary floating-point sign inversion.",
        pseudo: "neg = -value",
        example: "%neg = fneg float %value",
        reference: langRef("fneg-instruction"),
      }),
    },
  ],
  [
    "fadd",
    {
      label: "fadd",
      markdown: docMarkdown({
        summary: "Adds floating-point scalar or vector values.",
        usage:
          "Use it for floating-point addition. Fast-math flags describe allowed transformations.",
        pseudo: "sum = lhs + rhs",
        example: "%sum = fadd float %lhs, %rhs",
        reference: langRef("fadd-instruction"),
      }),
    },
  ],
  [
    "fsub",
    {
      label: "fsub",
      markdown: docMarkdown({
        summary: "Subtracts floating-point scalar or vector values.",
        usage: "Use it for floating-point difference calculations.",
        pseudo: "diff = lhs - rhs",
        example: "%diff = fsub float %lhs, %rhs",
        reference: langRef("fsub-instruction"),
      }),
    },
  ],
  [
    "fmul",
    {
      label: "fmul",
      markdown: docMarkdown({
        summary: "Multiplies floating-point scalar or vector values.",
        usage: "Use it for floating-point products.",
        pseudo: "product = lhs * rhs",
        example: "%product = fmul float %lhs, %rhs",
        reference: langRef("fmul-instruction"),
      }),
    },
  ],
  [
    "udiv",
    {
      label: "udiv",
      markdown: docMarkdown({
        summary: "Divides unsigned integer values.",
        usage:
          "Use it when operands are interpreted as unsigned. Division by zero is undefined behavior.",
        pseudo: "quotient = unsigned(lhs) / unsigned(rhs)",
        example: "%q = udiv i32 %lhs, %rhs",
        reference: langRef("udiv-instruction"),
      }),
    },
  ],
  [
    "sdiv",
    {
      label: "sdiv",
      markdown: docMarkdown({
        summary: "Divides signed integer values.",
        usage:
          "Use it when operands are interpreted as signed. Division by zero is undefined behavior.",
        pseudo: "quotient = signed(lhs) / signed(rhs)",
        example: "%q = sdiv i32 %lhs, %rhs",
        reference: langRef("sdiv-instruction"),
      }),
    },
  ],
  [
    "fdiv",
    {
      label: "fdiv",
      markdown: docMarkdown({
        summary: "Divides floating-point values.",
        usage: "Use it for floating-point division under the active floating-point semantics.",
        pseudo: "quotient = lhs / rhs",
        example: "%q = fdiv float %lhs, %rhs",
        reference: langRef("fdiv-instruction"),
      }),
    },
  ],
  [
    "urem",
    {
      label: "urem",
      markdown: docMarkdown({
        summary: "Computes the unsigned integer remainder.",
        usage: "Use it with unsigned operands after division-style calculations.",
        pseudo: "rem = unsigned(lhs) % unsigned(rhs)",
        example: "%r = urem i32 %lhs, %rhs",
        reference: langRef("urem-instruction"),
      }),
    },
  ],
  [
    "srem",
    {
      label: "srem",
      markdown: docMarkdown({
        summary: "Computes the signed integer remainder.",
        usage: "Use it with signed operands after division-style calculations.",
        pseudo: "rem = signed(lhs) % signed(rhs)",
        example: "%r = srem i32 %lhs, %rhs",
        reference: langRef("srem-instruction"),
      }),
    },
  ],
  [
    "frem",
    {
      label: "frem",
      markdown: docMarkdown({
        summary: "Computes the floating-point remainder.",
        usage: "Use it for IEEE-style floating-point remainder calculations.",
        pseudo: "rem = lhs % rhs",
        example: "%r = frem float %lhs, %rhs",
        reference: langRef("frem-instruction"),
      }),
    },
  ],
  [
    "shl",
    {
      label: "shl",
      markdown: docMarkdown({
        summary: "Shifts integer bits left.",
        usage: "Use it for multiplication by powers of two or bit packing.",
        pseudo: "result = value << amount",
        example: "%r = shl i32 %value, %amount",
        reference: langRef("shl-instruction"),
      }),
    },
  ],
  [
    "lshr",
    {
      label: "lshr",
      markdown: docMarkdown({
        summary: "Shifts integer bits right, filling with zero bits.",
        usage: "Use it for unsigned right shifts.",
        pseudo: "result = unsigned(value) >> amount",
        example: "%r = lshr i32 %value, %amount",
        reference: langRef("lshr-instruction"),
      }),
    },
  ],
  [
    "ashr",
    {
      label: "ashr",
      markdown: docMarkdown({
        summary: "Shifts integer bits right, preserving the sign bit.",
        usage: "Use it for signed right shifts.",
        pseudo: "result = signed(value) >> amount",
        example: "%r = ashr i32 %value, %amount",
        reference: langRef("ashr-instruction"),
      }),
    },
  ],
  [
    "and",
    {
      label: "and",
      markdown: docMarkdown({
        summary: "Computes bitwise AND.",
        usage: "Use it to mask bits or combine boolean-like integer values.",
        pseudo: "result = lhs & rhs",
        example: "%r = and i32 %lhs, %rhs",
        reference: langRef("and-instruction"),
      }),
    },
  ],
  [
    "or",
    {
      label: "or",
      markdown: docMarkdown({
        summary: "Computes bitwise OR.",
        usage: "Use it to set bits or combine boolean-like integer values.",
        pseudo: "result = lhs | rhs",
        example: "%r = or i32 %lhs, %rhs",
        reference: langRef("or-instruction"),
      }),
    },
  ],
  [
    "xor",
    {
      label: "xor",
      markdown: docMarkdown({
        summary: "Computes bitwise exclusive OR.",
        usage: "Use it to toggle bits or compare boolean-like integer values.",
        pseudo: "result = lhs ^ rhs",
        example: "%r = xor i32 %lhs, %rhs",
        reference: langRef("xor-instruction"),
      }),
    },
  ],
  [
    "extractelement",
    {
      label: "extractelement",
      markdown: docMarkdown({
        summary: "Reads one element from a vector.",
        usage: "Use it when scalar code needs a value from a vector lane.",
        pseudo: "element = vector[index]",
        example: "%e = extractelement <4 x i32> %v, i32 %i",
        reference: langRef("extractelement-instruction"),
      }),
    },
  ],
  [
    "insertelement",
    {
      label: "insertelement",
      markdown: docMarkdown({
        summary: "Writes one element into a vector value.",
        usage: "Use it to build or update a vector lane without mutating the original value.",
        pseudo: "result = vector with vector[index] = element",
        example: "%r = insertelement <4 x i32> %v, i32 %e, i32 %i",
        reference: langRef("insertelement-instruction"),
      }),
    },
  ],
  [
    "shufflevector",
    {
      label: "shufflevector",
      markdown: docMarkdown({
        summary: "Builds a vector by selecting lanes from input vectors.",
        usage: "Use it for lane rearrangement, splats, blends, and vector concatenation.",
        pseudo: "result = shuffle(a, b, mask)",
        example:
          "%r = shufflevector <4 x i32> %a, <4 x i32> %b, <4 x i32> <i32 0, i32 5, i32 2, i32 7>",
        reference: langRef("shufflevector-instruction"),
      }),
    },
  ],
  [
    "extractvalue",
    {
      label: "extractvalue",
      markdown: docMarkdown({
        summary: "Reads a field from an aggregate value.",
        usage: "Use it for structs or arrays represented as LLVM aggregate SSA values.",
        pseudo: "field = aggregate.path",
        example: "%x = extractvalue { i32, i1 } %pair, 0",
        reference: langRef("extractvalue-instruction"),
      }),
    },
  ],
  [
    "insertvalue",
    {
      label: "insertvalue",
      markdown: docMarkdown({
        summary: "Writes a field into an aggregate value.",
        usage: "Use it to construct or update aggregate SSA values.",
        pseudo: "result = aggregate with path = value",
        example: "%r = insertvalue { i32, i1 } %pair, i32 %x, 0",
        reference: langRef("insertvalue-instruction"),
      }),
    },
  ],
  [
    "fence",
    {
      label: "fence",
      markdown: docMarkdown({
        summary: "Introduces an atomic memory ordering barrier.",
        usage: "Use it to constrain memory reordering without loading or storing a value.",
        pseudo: "memory_barrier(ordering)",
        example: "fence seq_cst",
        reference: langRef("fence-instruction"),
      }),
    },
  ],
  [
    "cmpxchg",
    {
      label: "cmpxchg",
      markdown: docMarkdown({
        summary: "Atomically compares memory and exchanges it when equal.",
        usage: "Use it for lock-free compare-and-swap algorithms.",
        pseudo: "old = *ptr; if old == cmp then *ptr = new",
        example: "%r = cmpxchg ptr %ptr, i32 %cmp, i32 %new seq_cst monotonic",
        reference: langRef("cmpxchg-instruction"),
      }),
    },
  ],
  [
    "atomicrmw",
    {
      label: "atomicrmw",
      markdown: docMarkdown({
        summary: "Atomically performs a read-modify-write operation.",
        usage: "Use it for atomic counters, flags, and other single-memory-location updates.",
        pseudo: "old = *ptr; *ptr = old op value",
        example: "%old = atomicrmw add ptr %ptr, i32 1 seq_cst",
        reference: langRef("atomicrmw-instruction"),
      }),
    },
  ],
  [
    "getelementptr",
    {
      label: "getelementptr",
      markdown: docMarkdown({
        summary: "Computes the address of a subelement without accessing memory.",
        usage: "Use it for pointer arithmetic through LLVM types and indices.",
        pseudo: "field_ptr = &base[index]",
        example: "%p = getelementptr i32, ptr %base, i64 %index",
        reference: langRef("getelementptr-instruction"),
      }),
    },
  ],
  [
    "trunc",
    {
      label: "trunc",
      markdown: docMarkdown({
        summary: "Converts an integer to a smaller integer type.",
        usage: "Use it when high bits can be discarded.",
        pseudo: "small = low_bits(value)",
        example: "%small = trunc i64 %value to i32",
        reference: langRef("trunc-to-instruction"),
      }),
    },
  ],
  [
    "zext",
    {
      label: "zext",
      markdown: docMarkdown({
        summary: "Converts an integer to a larger integer type by zero extension.",
        usage: "Use it when the source is unsigned or bit-pattern zero extension is required.",
        pseudo: "wide = zero_extend(value)",
        example: "%wide = zext i32 %value to i64",
        reference: langRef("zext-to-instruction"),
      }),
    },
  ],
  [
    "sext",
    {
      label: "sext",
      markdown: docMarkdown({
        summary: "Converts an integer to a larger integer type by sign extension.",
        usage: "Use it when the source is signed and the sign must be preserved.",
        pseudo: "wide = sign_extend(value)",
        example: "%wide = sext i32 %value to i64",
        reference: langRef("sext-to-instruction"),
      }),
    },
  ],
  [
    "fptrunc",
    {
      label: "fptrunc",
      markdown: docMarkdown({
        summary: "Converts a floating-point value to a smaller floating-point type.",
        usage: "Use it when precision loss is acceptable or required.",
        pseudo: "small = round_to_smaller_float(value)",
        example: "%small = fptrunc double %value to float",
        reference: langRef("fptrunc-to-instruction"),
      }),
    },
  ],
  [
    "fpext",
    {
      label: "fpext",
      markdown: docMarkdown({
        summary: "Converts a floating-point value to a larger floating-point type.",
        usage: "Use it when a computation needs more precision or a wider ABI type.",
        pseudo: "wide = extend_float(value)",
        example: "%wide = fpext float %value to double",
        reference: langRef("fpext-to-instruction"),
      }),
    },
  ],
  [
    "fptoui",
    {
      label: "fptoui",
      markdown: docMarkdown({
        summary: "Converts a floating-point value to an unsigned integer.",
        usage:
          "Use it when fractional parts should be discarded toward zero and the result is unsigned.",
        pseudo: "uint = unsigned_integer(value)",
        example: "%i = fptoui float %value to i32",
        reference: langRef("fptoui-to-instruction"),
      }),
    },
  ],
  [
    "fptosi",
    {
      label: "fptosi",
      markdown: docMarkdown({
        summary: "Converts a floating-point value to a signed integer.",
        usage:
          "Use it when fractional parts should be discarded toward zero and the result is signed.",
        pseudo: "int = signed_integer(value)",
        example: "%i = fptosi float %value to i32",
        reference: langRef("fptosi-to-instruction"),
      }),
    },
  ],
  [
    "uitofp",
    {
      label: "uitofp",
      markdown: docMarkdown({
        summary: "Converts an unsigned integer to a floating-point value.",
        usage: "Use it when integer bits represent an unsigned number.",
        pseudo: "float_value = float(unsigned(value))",
        example: "%f = uitofp i32 %value to float",
        reference: langRef("uitofp-to-instruction"),
      }),
    },
  ],
  [
    "sitofp",
    {
      label: "sitofp",
      markdown: docMarkdown({
        summary: "Converts a signed integer to a floating-point value.",
        usage: "Use it when integer bits represent a signed number.",
        pseudo: "float_value = float(signed(value))",
        example: "%f = sitofp i32 %value to float",
        reference: langRef("sitofp-to-instruction"),
      }),
    },
  ],
  [
    "ptrtoint",
    {
      label: "ptrtoint",
      markdown: docMarkdown({
        summary: "Converts a pointer value to an integer.",
        usage: "Use it when pointer bits must be represented as an integer value.",
        pseudo: "int_value = pointer_bits(p)",
        example: "%i = ptrtoint ptr %p to i64",
        reference: langRef("ptrtoint-to-instruction"),
      }),
    },
  ],
  [
    "inttoptr",
    {
      label: "inttoptr",
      markdown: docMarkdown({
        summary: "Converts an integer value to a pointer.",
        usage: "Use it for low-level address materialization when the target semantics allow it.",
        pseudo: "p = pointer_from_bits(i)",
        example: "%p = inttoptr i64 %i to ptr",
        reference: langRef("inttoptr-to-instruction"),
      }),
    },
  ],
  [
    "bitcast",
    {
      label: "bitcast",
      markdown: docMarkdown({
        summary: "Reinterprets a value as another type of the same bit width.",
        usage: "Use it for representation-preserving casts.",
        pseudo: "result = reinterpret(value)",
        example: "%p = bitcast ptr %raw to ptr",
        reference: langRef("bitcast-to-instruction"),
      }),
    },
  ],
  [
    "addrspacecast",
    {
      label: "addrspacecast",
      markdown: docMarkdown({
        summary: "Converts a pointer between address spaces.",
        usage: "Use it when target address spaces require an explicit pointer conversion.",
        pseudo: "p2 = cast_address_space(p)",
        example: "%p2 = addrspacecast ptr %p to ptr addrspace(1)",
        reference: langRef("addrspacecast-to-instruction"),
      }),
    },
  ],
  [
    "icmp",
    {
      label: "icmp",
      markdown: docMarkdown({
        summary: "Compares integer, pointer, or vector values.",
        usage:
          "Use it with predicates such as `eq`, `ne`, `slt`, or `ult`; the result is `i1` or a vector of `i1`.",
        pseudo: "is_equal = lhs == rhs",
        example: "%is_equal = icmp eq i32 %lhs, %rhs",
        reference: langRef("icmp-instruction"),
      }),
    },
  ],
  [
    "fcmp",
    {
      label: "fcmp",
      markdown: docMarkdown({
        summary: "Compares floating-point or floating-point vector values.",
        usage: "Use ordered or unordered predicates depending on how NaN should affect the result.",
        pseudo: "is_less = lhs < rhs",
        example: "%is_less = fcmp olt float %lhs, %rhs",
        reference: langRef("fcmp-instruction"),
      }),
    },
  ],
  [
    "select",
    {
      label: "select",
      markdown: docMarkdown({
        summary: "Chooses between two values without branching.",
        usage:
          "Use it for expression-level conditional values when both alternatives are available.",
        pseudo: "result = cond ? a : b",
        example: "%r = select i1 %cond, i32 %a, i32 %b",
        reference: langRef("select-instruction"),
      }),
    },
  ],
  [
    "freeze",
    {
      label: "freeze",
      markdown: docMarkdown({
        summary: "Turns undef or poison into a stable arbitrary value.",
        usage:
          "Use it to stop poison or undef from propagating while keeping a valid value of the same type.",
        pseudo: "stable = freeze(value)",
        example: "%stable = freeze i32 %value",
        reference: langRef("freeze-instruction"),
      }),
    },
  ],
  [
    "va_arg",
    {
      label: "va_arg",
      markdown: docMarkdown({
        summary: "Reads the next argument from a variable argument list.",
        usage: "Use it for lowering C-style varargs.",
        pseudo: "arg = next_vararg(list)",
        example: "%arg = va_arg ptr %ap, i32",
        reference: langRef("va-arg-instruction"),
      }),
    },
  ],
  [
    "landingpad",
    {
      label: "landingpad",
      markdown: docMarkdown({
        summary: "Creates an exception handling landing pad value.",
        usage: "Use it in exception handling blocks reached from `invoke` unwind edges.",
        pseudo: "exception = landing_pad()",
        example: "%lp = landingpad { ptr, i32 } cleanup",
        reference: langRef("landingpad-instruction"),
      }),
    },
  ],
  [
    "catchpad",
    {
      label: "catchpad",
      markdown: docMarkdown({
        summary: "Begins a catch handler pad.",
        usage: "Use it inside a catchswitch target to receive exception objects.",
        pseudo: "catch exception",
        example: "%pad = catchpad within %cs [ptr null]",
        reference: langRef("catchpad-instruction"),
      }),
    },
  ],
  [
    "cleanuppad",
    {
      label: "cleanuppad",
      markdown: docMarkdown({
        summary: "Begins a cleanup handler pad.",
        usage: "Use it for cleanup code that runs during exception unwinding.",
        pseudo: "run cleanup",
        example: "%pad = cleanuppad within none []",
        reference: langRef("cleanuppad-instruction"),
      }),
    },
  ],
  [
    "define",
    {
      label: "define",
      markdown: docMarkdown({
        summary: "Introduces a function with a body.",
        usage: "Use it when the module provides the function implementation.",
        pseudo: "function body is defined here",
        example: "define i32 @main() { ret i32 0 }",
        reference: langRef("functions"),
      }),
    },
  ],
  [
    "declare",
    {
      label: "declare",
      markdown: docMarkdown({
        summary: "Introduces a function signature without a body.",
        usage: "Use it for external functions implemented outside this module.",
        pseudo: "external function signature",
        example: "declare i32 @puts(ptr)",
        reference: langRef("functions"),
      }),
    },
  ],
]);

/**
 * よく使う LLVM IR 型のドキュメント辞書。
 *
 * @remarks
 * opaque pointer 前提の `ptr` と、整数型、浮動小数点型、特殊な IR 型を補完候補として提供する。
 *
 * @example
 * const pointerDoc = typeDocs.get("ptr");
 * pointerDoc?.label; // "ptr"
 *
 * @public
 */
export const typeDocs = new Map<string, DocEntry>([
  [
    "void",
    {
      label: "void",
      markdown: docMarkdown({
        summary: "Type with no runtime value.",
        usage:
          "Use it as a function result type when the function returns only by side effect or control flow.",
        pseudo: "sink(value) returns nothing",
        example: "define void @sink(i32 %value) { ... }",
        reference: langRef("void-type"),
      }),
    },
  ],
  [
    "ptr",
    {
      label: "ptr",
      markdown: docMarkdown({
        summary: "LLVM opaque pointer type.",
        usage: "Use it for addresses without encoding the pointee type in the pointer itself.",
        pseudo: "addr points to memory",
        example: "%value = load i32, ptr %addr",
        reference: langRef("pointer-type"),
      }),
    },
  ],
  [
    "label",
    {
      label: "label",
      markdown: docMarkdown({
        summary: "Type of a basic block label.",
        usage: "Use it in terminators and constructs that refer to basic blocks.",
        pseudo: "jump to exit",
        example: "br label %exit",
        reference: langRef("label-type"),
      }),
    },
  ],
  [
    "metadata",
    {
      label: "metadata",
      markdown: docMarkdown({
        summary: "Type for debug info and other metadata nodes.",
        usage: "Use it for compiler annotations that are not ordinary runtime values.",
        pseudo: "attach debug metadata",
        example: "!dbg !12",
        reference: langRef("metadata-type"),
      }),
    },
  ],
  [
    "i1",
    {
      label: "i1",
      markdown: docMarkdown({
        summary: "1-bit integer type, commonly used for conditions.",
        usage:
          "Use it for boolean-like SSA values such as `icmp` results and conditional branches.",
        pseudo: "cond is true or false",
        example: "br i1 %cond, label %then, label %else",
        reference: langRef("integer-type"),
      }),
    },
  ],
  [
    "i8",
    {
      label: "i8",
      markdown: docMarkdown({
        summary: "8-bit integer type.",
        usage: "Use it for byte-sized integer values and raw data elements.",
        pseudo: "byte = *addr",
        example: "%byte = load i8, ptr %addr",
        reference: langRef("integer-type"),
      }),
    },
  ],
  [
    "i32",
    {
      label: "i32",
      markdown: docMarkdown({
        summary: "32-bit integer type.",
        usage: "Use it for common scalar integer arithmetic and C-like `int` values.",
        pseudo: "sum = lhs + rhs",
        example: "%sum = add i32 %lhs, %rhs",
        reference: langRef("integer-type"),
      }),
    },
  ],
  [
    "i64",
    {
      label: "i64",
      markdown: docMarkdown({
        summary: "64-bit integer type.",
        usage:
          "Use it for wide integer arithmetic, sizes, and target-sized values when appropriate.",
        pseudo: "next = index + 1",
        example: "%next = add i64 %index, 1",
        reference: langRef("integer-type"),
      }),
    },
  ],
  [
    "b32",
    {
      label: "b32",
      markdown: docMarkdown({
        summary: "32-bit byte type.",
        usage:
          "Use byte types where the IR needs byte-oriented values instead of ordinary integers.",
        pseudo: "x = *addr",
        example: "%x = load b32, ptr %addr",
        reference: langRef("integer-type"),
      }),
    },
  ],
  [
    "float",
    {
      label: "float",
      markdown: docMarkdown({
        summary: "32-bit floating-point type.",
        usage: "Use it for single-precision floating-point arithmetic.",
        pseudo: "sum = lhs + rhs",
        example: "%sum = fadd float %lhs, %rhs",
        reference: langRef("floating-point-types"),
      }),
    },
  ],
  [
    "double",
    {
      label: "double",
      markdown: docMarkdown({
        summary: "64-bit floating-point type.",
        usage: "Use it for double-precision floating-point arithmetic.",
        pseudo: "sum = lhs + rhs",
        example: "%sum = fadd double %lhs, %rhs",
        reference: langRef("floating-point-types"),
      }),
    },
  ],
]);

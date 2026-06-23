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

const attributeDoc = (label: string, options: DocMarkdownOptions): readonly [string, DocEntry] => [
  label,
  {
    label,
    markdown: docMarkdown(options),
  },
];

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
        example: 'callbr void asm sideeffect "", "!i"() to label %fallthrough [label %target]',
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
        usage: "Use it for fmod-style floating-point remainder calculations.",
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
        summary: "Compares integer, pointer, integer-vector, or pointer-vector values.",
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
 * LLVM IR 属性のドキュメント辞書。
 *
 * @remarks
 * 属性は関数・戻り値・引数・call site の契約を表すため、hover では代表的な意味と
 * 最小の使用例だけを表示し、詳細は公式 LangRef へ委ねる。
 *
 * @example
 * const doc = attributeDocs.get("noundef");
 * doc?.markdown; // undef / poison を許さない契約の説明
 *
 * @public
 */
export const attributeDocs = new Map<string, DocEntry>([
  [
    "zeroext",
    {
      label: "zeroext",
      markdown: docMarkdown({
        summary: "Zero-extends an integer parameter or return value as required by the target ABI.",
        usage:
          "Use it on declarations, definitions, and matching call sites when the ABI requires zero extension.",
        pseudo: "arg is passed with zero extension",
        example: "declare i32 @atoi(i8 zeroext)",
        reference: langRef("parameter-attributes"),
      }),
    },
  ],
  [
    "signext",
    {
      label: "signext",
      markdown: docMarkdown({
        summary: "Sign-extends an integer parameter or return value as required by the target ABI.",
        usage:
          "Use it consistently at the function boundary and call site when the target ABI depends on sign extension.",
        pseudo: "result is returned with sign extension",
        example: "declare signext i8 @returns_signed_char()",
        reference: langRef("parameter-attributes"),
      }),
    },
  ],
  [
    "noalias",
    {
      label: "noalias",
      markdown: docMarkdown({
        summary:
          "States that modified memory accessed through pointer values based on this argument or return value does not alias other accesses.",
        usage:
          "Use it on pointer arguments or return values only when the frontend can prove the LangRef aliasing contract.",
        pseudo: "modified memory reached from p does not alias",
        example: "declare void @fill(ptr noalias %dst)",
        reference: langRef("noalias"),
      }),
    },
  ],
  [
    "captures",
    {
      label: "captures",
      markdown: docMarkdown({
        summary: "Restricts how the callee may capture a pointer argument.",
        usage:
          "Use `captures(none)` when the callee does not retain the pointer, or list the captured pointer components explicitly.",
        pseudo: "callee does not keep p",
        example: "declare void @use(ptr captures(none) %p)",
        reference: langRef("captures-attr"),
      }),
    },
  ],
  [
    "returned",
    {
      label: "returned",
      markdown: docMarkdown({
        summary: "States that the function always returns this argument as its return value.",
        usage: "Use it when an argument is forwarded directly to the return value.",
        pseudo: "return p",
        example: "declare ptr @identity(ptr returned %p)",
        reference: langRef("parameter-attributes"),
      }),
    },
  ],
  [
    "nonnull",
    {
      label: "nonnull",
      markdown: docMarkdown({
        summary: "States that a pointer parameter or return value is not null.",
        usage:
          "Use it when null is impossible. Combine with `noundef` when the value itself must be well defined.",
        pseudo: "p != null",
        example: "declare void @use(ptr nonnull %p)",
        reference: langRef("attr-nonnull"),
      }),
    },
  ],
  [
    "dereferenceable",
    {
      label: "dereferenceable",
      markdown: docMarkdown({
        summary:
          "States that a pointer parameter or return value can be safely dereferenced for N bytes.",
        usage: "Use `dereferenceable(N)` only when those bytes can be speculatively loaded.",
        pseudo: "p points to at least N bytes",
        example: "declare void @read(ptr dereferenceable(4) %p)",
        reference: langRef("attr-dereferenceable"),
      }),
    },
  ],
  [
    "noundef",
    {
      label: "noundef",
      markdown: docMarkdown({
        summary: "States that a parameter or return value must not be undef or poison.",
        usage:
          "Use it to make a function boundary require a fully defined value; violating it produces undefined behavior.",
        pseudo: "value is fully defined",
        example: "declare void @use(i32 noundef %x)",
        reference: langRef("attr-noundef"),
      }),
    },
  ],
  [
    "nofpclass",
    {
      label: "nofpclass",
      markdown: docMarkdown({
        summary: "Excludes floating-point classes from a parameter or return value.",
        usage:
          "Use `nofpclass(mask)` to state that matching floating-point classes are replaced by poison at the boundary.",
        pseudo: "x is not NaN",
        example: "declare void @use(float nofpclass(nan) %x)",
        reference: langRef("nofpclass"),
      }),
    },
  ],
  [
    "range",
    {
      label: "range",
      markdown: docMarkdown({
        summary:
          "Constrains the possible values of a parameter or return value to constant ranges.",
        usage:
          "Use `range(<ty> a, b)` when values outside the half-open range `[a, b)` should become poison.",
        pseudo: "0 <= x < 10",
        example: "declare void @use(i32 range(i32 0, 10) %x)",
        reference: langRef("parameter-attributes"),
      }),
    },
  ],
  [
    "nounwind",
    {
      label: "nounwind",
      markdown: docMarkdown({
        summary: "States that the function never raises an exception.",
        usage:
          "Use it only when unwinding out of the function cannot occur; unwinding through it is undefined behavior.",
        pseudo: "f cannot unwind",
        example: "define void @f() nounwind { ret void }",
        reference: langRef("function-attributes"),
      }),
    },
  ],
  [
    "noreturn",
    {
      label: "noreturn",
      markdown: docMarkdown({
        summary: "States that the function never returns normally to its caller.",
        usage:
          "Use it for functions that terminate, trap, or otherwise do not resume normal control flow.",
        pseudo: "call does not return",
        example: "declare void @fatal() noreturn",
        reference: langRef("function-attributes"),
      }),
    },
  ],
  [
    "willreturn",
    {
      label: "willreturn",
      markdown: docMarkdown({
        summary:
          "States that a call of the function will either return normally or have undefined behavior.",
        usage:
          "Use it when infinite looping without returning or unwinding is not a valid behavior for this function.",
        pseudo: "f eventually returns",
        example: "declare i32 @pure(i32 %x) willreturn",
        reference: langRef("function-attributes"),
      }),
    },
  ],
  [
    "memory",
    {
      label: "memory",
      markdown: docMarkdown({
        summary: "Describes the possible memory effects of a function or call site.",
        usage:
          "Use `memory(none)`, `memory(read)`, `memory(write)`, or location-qualified forms to constrain memory access.",
        pseudo: "f may only read memory",
        example: "define void @scan(ptr %p) memory(read) { ret void }",
        reference: langRef("function-attributes"),
      }),
    },
  ],
  [
    "readnone",
    {
      label: "readnone",
      markdown: docMarkdown({
        summary: "States that the callee does not dereference this pointer argument.",
        usage:
          "Use it on pointer parameters when the callee may receive the pointer but must not access memory through it.",
        pseudo: "callee does not dereference p",
        example: "declare void @observe(ptr readnone %p)",
        reference: langRef("parameter-attributes"),
      }),
    },
  ],
  [
    "readonly",
    {
      label: "readonly",
      markdown: docMarkdown({
        summary: "States that the callee does not write through this pointer argument.",
        usage:
          "Use it on pointer parameters when the callee may read through the pointer but must not write through it.",
        pseudo: "callee may read p but not write it",
        example: "declare void @peek(ptr readonly %p)",
        reference: langRef("parameter-attributes"),
      }),
    },
  ],
  [
    "writeonly",
    {
      label: "writeonly",
      markdown: docMarkdown({
        summary:
          "States that the callee may write through this pointer argument but does not read through it.",
        usage:
          "Use it on pointer parameters when only writes through the pointer are observable under the attribute contract.",
        pseudo: "callee may write p but not read it",
        example: "declare void @zero(ptr writeonly %p)",
        reference: langRef("parameter-attributes"),
      }),
    },
  ],
  [
    "nofree",
    {
      label: "nofree",
      markdown: docMarkdown({
        summary: "States that the function or argument contract does not free relevant memory.",
        usage:
          "Use it when calls through the annotated function boundary cannot deallocate memory visible under that contract.",
        pseudo: "f does not free memory",
        example: "declare void @visit(ptr %p) nofree",
        reference: langRef("function-attributes"),
      }),
    },
  ],
  [
    "nosync",
    {
      label: "nosync",
      markdown: docMarkdown({
        summary:
          "States that the function does not introduce synchronization that communicates with another thread.",
        usage:
          "Use it when the function has no cross-thread synchronization behavior relevant to LLVM's memory model.",
        pseudo: "f does not synchronize with other threads",
        example: "declare i32 @local_calc(i32 %x) nosync",
        reference: langRef("function-attributes"),
      }),
    },
  ],
  [
    "noinline",
    {
      label: "noinline",
      markdown: docMarkdown({
        summary: "Prevents the inliner from inlining this function.",
        usage: "Use it when the function body must remain out of line.",
        pseudo: "do not inline f",
        example: "define void @f() noinline { ret void }",
        reference: langRef("function-attributes"),
      }),
    },
  ],
  [
    "alwaysinline",
    {
      label: "alwaysinline",
      markdown: docMarkdown({
        summary: "Requests that the inliner attempts to inline this function.",
        usage:
          "Use it only when inlining is semantically or performance critical; it is incompatible with `noinline`.",
        pseudo: "try to inline f",
        example: "define void @f() alwaysinline { ret void }",
        reference: langRef("function-attributes"),
      }),
    },
  ],
  [
    "cold",
    {
      label: "cold",
      markdown: docMarkdown({
        summary: "Marks the function as unlikely to execute often.",
        usage: "Use it for error paths or slow paths when profile data is unavailable.",
        pseudo: "f is a cold path",
        example: "declare void @slow_path() cold",
        reference: langRef("attr-cold"),
      }),
    },
  ],
  [
    "hot",
    {
      label: "hot",
      markdown: docMarkdown({
        summary: "Marks the function as a hot spot of the program.",
        usage:
          "Use it when the frontend knows the function is frequently executed and profile data should be overridden.",
        pseudo: "f is a hot path",
        example: "declare void @fast_path() hot",
        reference: langRef("function-attributes"),
      }),
    },
  ],
  [
    "denormal_fpenv",
    {
      label: "denormal_fpenv",
      markdown: docMarkdown({
        summary: "Specifies the denormal floating-point environment for the function.",
        usage:
          "Use it when the frontend needs to describe how denormal inputs and outputs are handled.",
        pseudo: "f uses the IEEE denormal mode",
        example: "attributes #0 = { denormal_fpenv(ieee|ieee) }",
        reference: langRef("denormal-fpenv"),
      }),
    },
  ],
  attributeDoc("noext", {
    summary: "Leaves integer extension at the function boundary unspecified by the IR.",
    usage: "Use it when the target ABI does not require `zeroext` or `signext` for this value.",
    pseudo: "argument extension is target-defined",
    example: "declare void @use(i8 noext %x)",
    reference: langRef("parameter-attributes"),
  }),
  attributeDoc("inreg", {
    summary: "Requests that the parameter or return value is passed in registers if possible.",
    usage: "Use it only for ABI-sensitive declarations and matching call sites.",
    pseudo: "pass value in a register",
    example: "declare void @use(i32 inreg %x)",
    reference: langRef("parameter-attributes"),
  }),
  attributeDoc("byval", {
    summary: "Passes a pointer argument by making a hidden copy of the pointee.",
    usage:
      "Use `byval(<ty>)` when the callee should receive a stack copy rather than the original object.",
    pseudo: "callee receives a copy of the pointee",
    example: "declare void @use(ptr byval(i32) %p)",
    reference: langRef("parameter-attributes"),
  }),
  attributeDoc("byref", {
    summary:
      "Passes a pointer to an object whose pointee type and ABI properties are made explicit.",
    usage: "Use `byref(<ty>)` for ABI lowering that needs an explicit referenced object type.",
    pseudo: "p references an ABI object",
    example: "declare void @use(ptr byref(i32) %p)",
    reference: langRef("attr-byref"),
  }),
  attributeDoc("preallocated", {
    summary: "Marks a pointer parameter as storage that was preallocated by the caller.",
    usage:
      "Use `preallocated(<ty>)` with the matching operand bundle protocol for preallocated calls.",
    pseudo: "caller preallocates argument storage",
    example: "declare void @use(ptr preallocated(i32) %p)",
    reference: langRef("attr-preallocated"),
  }),
  attributeDoc("inalloca", {
    summary: "Marks a pointer parameter as the address of an incoming argument allocation.",
    usage:
      "Use `inalloca(<ty>)` for ABI schemes where outgoing arguments live in a caller allocation.",
    pseudo: "argument storage is in an alloca",
    example: "declare void @use(ptr inalloca(i32) %p)",
    reference: langRef("attr-inalloca"),
  }),
  attributeDoc("sret", {
    summary: "Marks a pointer parameter as the hidden structure return destination.",
    usage: "Use `sret(<ty>)` when the caller provides storage for an aggregate return value.",
    pseudo: "write return object into p",
    example: "declare void @make(ptr sret({ i32, i32 }) %out)",
    reference: langRef("parameter-attributes"),
  }),
  attributeDoc("elementtype", {
    summary: "Supplies an element type for an intrinsic pointer argument.",
    usage:
      "Use `elementtype(<ty>)` where an intrinsic requires pointee type information with opaque pointers.",
    pseudo: "p is treated as pointing to ty",
    example: "declare void @llvm.example(ptr elementtype(i32) %p)",
    reference: langRef("attr-elementtype"),
  }),
  attributeDoc("align", {
    summary: "States an alignment guarantee for a pointer parameter or return value.",
    usage:
      "Use `align N` only when the pointer is known to have at least that power-of-two alignment.",
    pseudo: "p is aligned to N bytes",
    example: "declare void @use(ptr align 16 %p)",
    reference: langRef("attr-align"),
  }),
  attributeDoc("dereferenceable_or_null", {
    summary: "States that a pointer is either null or dereferenceable for N bytes.",
    usage:
      "Use `dereferenceable_or_null(N)` for nullable pointers with a dereferenceability guarantee when non-null.",
    pseudo: "p == null || p points to at least N bytes",
    example: "declare void @use(ptr dereferenceable_or_null(8) %p)",
    reference: langRef("attr-dereferenceable-or-null"),
  }),
  attributeDoc("writable", {
    summary: "Strengthens a dereferenceable pointer argument by guaranteeing writable bytes.",
    usage: "Use it with `dereferenceable(N)` when every byte in the range may be written.",
    pseudo: "p points to writable bytes",
    example: "declare void @use(ptr dereferenceable(4) writable %p)",
    reference: langRef("parameter-attributes"),
  }),
  attributeDoc("initializes", {
    summary: "States that the callee initializes specified byte ranges of a pointer argument.",
    usage: "Use `initializes(...)` to describe writes that make uninitialized memory initialized.",
    pseudo: "callee initializes byte ranges",
    example: "declare void @init(ptr initializes((0, 4)) %p)",
    reference: langRef("parameter-attributes"),
  }),
  attributeDoc("dead_on_unwind", {
    summary: "States that a pointer argument's memory is dead if the call unwinds.",
    usage: "Use it for output storage whose contents are not observable on unwind paths.",
    pseudo: "p is dead on unwind",
    example: "declare void @init(ptr dead_on_unwind %p)",
    reference: langRef("parameter-attributes"),
  }),
  attributeDoc("dead_on_return", {
    summary: "States that a pointer argument's memory is dead after the call returns.",
    usage: "Use it when the caller will not observe the pointed-to contents after return.",
    pseudo: "p is dead on return",
    example: "declare void @consume(ptr dead_on_return %p)",
    reference: langRef("parameter-attributes"),
  }),
  attributeDoc("swiftself", {
    summary: "Marks a parameter as the Swift self context parameter.",
    usage: "Use it for Swift ABI lowering where the parameter carries `self`.",
    pseudo: "p is Swift self",
    example: "declare void @method(ptr swiftself %self)",
    reference: langRef("parameter-attributes"),
  }),
  attributeDoc("nest", {
    summary: "Marks a pointer parameter as the static chain for a nested function.",
    usage: "Use it for frontends that lower nested functions with an explicit environment pointer.",
    pseudo: "p is the nested function environment",
    example: "declare void @nested(ptr nest %env)",
    reference: langRef("nest"),
  }),
  attributeDoc("swiftasync", {
    summary: "Marks a parameter as the Swift async context parameter.",
    usage: "Use it for Swift async ABI lowering.",
    pseudo: "p is Swift async context",
    example: "declare void @async(ptr swiftasync %context)",
    reference: langRef("swiftasync"),
  }),
  attributeDoc("swifterror", {
    summary: "Marks a parameter as the Swift error register parameter.",
    usage: "Use it only for Swift error propagation ABI lowering.",
    pseudo: "p carries Swift error state",
    example: "declare void @throw(ptr swifterror %error)",
    reference: langRef("parameter-attributes"),
  }),
  attributeDoc("immarg", {
    summary: "Requires an intrinsic argument to be an immediate constant.",
    usage:
      "Use it on intrinsic declarations for operands that must be known constants at the call site.",
    pseudo: "argument must be immediate",
    example: "declare void @llvm.example(i32 immarg %mode)",
    reference: langRef("parameter-attributes"),
  }),
  attributeDoc("allocalign", {
    summary: "Identifies the parameter that specifies an allocation alignment.",
    usage:
      "Use it on allocator-like functions where a parameter controls returned pointer alignment.",
    pseudo: "alignment comes from this argument",
    example: "declare ptr @aligned_alloc(i64 allocalign %align)",
    reference: langRef("parameter-attributes"),
  }),
  attributeDoc("allocptr", {
    summary: "Marks a parameter as an allocation pointer for allocation-family semantics.",
    usage:
      "Use it on allocator or reallocator declarations when the parameter is the allocation pointer.",
    pseudo: "p is the allocation pointer",
    example: "declare ptr @realloc(ptr allocptr %p, i64 %size)",
    reference: langRef("parameter-attributes"),
  }),
  attributeDoc("alignstack", {
    summary: "Requests increased stack alignment for calls or functions.",
    usage: "Use `alignstack(N)` when a function requires a specific stack alignment.",
    pseudo: "stack is aligned to N bytes",
    example: "attributes #0 = { alignstack(16) }",
    reference: langRef("function-attributes"),
  }),
  attributeDoc('"alloc-family"', {
    summary: "Names the allocation family for an allocation-like function.",
    usage: "Use it to group allocation and deallocation functions for optimizer reasoning.",
    pseudo: "allocator belongs to FAMILY",
    example: 'attributes #0 = { "alloc-family"="malloc" }',
    reference: langRef("function-attributes"),
  }),
  attributeDoc("allockind", {
    summary: "Describes allocation behavior such as allocation, reallocation, or freeing.",
    usage:
      "Use `allockind(...)` on allocation-family functions to describe the kind of memory operation.",
    pseudo: "function allocates memory",
    example: 'attributes #0 = { allockind("alloc,uninitialized") }',
    reference: langRef("function-attributes"),
  }),
  attributeDoc('"alloc-variant-zeroed"', {
    summary: "Names a zero-initializing variant of an allocation function.",
    usage: "Use it to connect an allocator to a corresponding zeroed allocator variant.",
    pseudo: "zeroed allocator variant is FUNCTION",
    example: 'attributes #0 = { "alloc-variant-zeroed"="calloc" }',
    reference: langRef("function-attributes"),
  }),
  attributeDoc("allocsize", {
    summary: "Identifies parameter indexes that determine allocation size.",
    usage: "Use `allocsize(...)` on allocator-like functions to expose returned object size.",
    pseudo: "allocated size comes from arguments",
    example: "declare ptr @malloc(i64 %size) allocsize(0)",
    reference: langRef("function-attributes"),
  }),
  attributeDoc("builtin", {
    summary: "Allows a call site to be treated as a recognized built-in function.",
    usage:
      "Use it when a call should retain built-in semantics even with other built-in controls nearby.",
    pseudo: "callee may use builtin semantics",
    example: "declare void @memcpy(ptr %dst, ptr %src, i64 %n) builtin",
    reference: langRef("function-attributes"),
  }),
  attributeDoc("convergent", {
    summary: "Prevents transformations that would change convergence-sensitive control behavior.",
    usage: "Use it for operations whose behavior depends on dynamic groups of executing threads.",
    pseudo: "do not duplicate or move convergence",
    example: "declare void @barrier() convergent",
    reference: langRef("attr-convergent"),
  }),
  attributeDoc("disable_sanitizer_instrumentation", {
    summary: "Disables sanitizer instrumentation for the function.",
    usage: "Use it when sanitizer-added code must be suppressed for this function.",
    pseudo: "do not instrument with sanitizers",
    example: "declare void @raw() disable_sanitizer_instrumentation",
    reference: langRef("function-attributes"),
  }),
  attributeDoc('"dontcall-error"', {
    summary: "Requests an error diagnostic if the function is called.",
    usage: "Use it for functions that must not remain as calls after lowering or optimization.",
    pseudo: "calling f is an error",
    example: 'attributes #0 = { "dontcall-error"="do not call" }',
    reference: langRef("function-attributes"),
  }),
  attributeDoc('"dontcall-warn"', {
    summary: "Requests a warning diagnostic if the function is called.",
    usage: "Use it for calls that are discouraged but not fatal for code generation.",
    pseudo: "calling f is a warning",
    example: 'attributes #0 = { "dontcall-warn"="avoid this call" }',
    reference: langRef("function-attributes"),
  }),
  attributeDoc("fn_ret_thunk_extern", {
    summary: "Uses an external return thunk for function returns.",
    usage: "Use it for targets or mitigations that require returns through a thunk.",
    pseudo: "return through external thunk",
    example: "declare void @f() fn_ret_thunk_extern",
    reference: langRef("function-attributes"),
  }),
  attributeDoc('"frame-pointer"', {
    summary: "Controls the frame pointer policy for the function.",
    usage:
      "Use values such as `none`, `non-leaf`, or `all` to request frame pointer preservation policy.",
    pseudo: "frame pointer policy is selected",
    example: 'attributes #0 = { "frame-pointer"="all" }',
    reference: langRef("function-attributes"),
  }),
  attributeDoc("inlinehint", {
    summary: "Suggests that the inliner should prefer inlining this function.",
    usage: "Use it as a non-mandatory inlining hint, unlike `alwaysinline`.",
    pseudo: "prefer to inline f",
    example: "define void @f() inlinehint { ret void }",
    reference: langRef("function-attributes"),
  }),
  attributeDoc("jumptable", {
    summary: "Requests jump-table entry generation for address-taken references to the function.",
    usage:
      "Use it only for targets and functions where jump-instruction table lowering is required.",
    pseudo: "address-taken references go through a jump table",
    example: "declare void @f() unnamed_addr jumptable",
    reference: langRef("function-attributes"),
  }),
  attributeDoc("minsize", {
    summary: "Requests optimization for minimum code size.",
    usage: "Use it when generated code size should be minimized even at performance cost.",
    pseudo: "optimize f for minimum size",
    example: "define void @f() minsize { ret void }",
    reference: langRef("function-attributes"),
  }),
  attributeDoc("naked", {
    summary: "Disables prologue and epilogue emission for the function.",
    usage:
      "Use it only for low-level functions whose body handles the calling convention manually.",
    pseudo: "emit no prologue or epilogue",
    example: "define void @f() naked { ret void }",
    reference: langRef("function-attributes"),
  }),
  attributeDoc('"no-inline-line-tables"', {
    summary: "Controls debug line table emission for inlined code.",
    usage: "Use it when inline debug line tables should be suppressed.",
    pseudo: "omit inline line tables",
    example: 'attributes #0 = { "no-inline-line-tables"="true" }',
    reference: langRef("function-attributes"),
  }),
  attributeDoc("no-jump-tables", {
    summary: "Disables jump table and lookup table generation from switch lowering.",
    usage: "Use it when indirect jump tables are undesirable for this function.",
    pseudo: "do not generate jump tables",
    example: "attributes #0 = { no-jump-tables }",
    reference: langRef("function-attributes"),
  }),
  attributeDoc("nobuiltin", {
    summary: "Prevents recognizing the callee as a built-in function.",
    usage:
      "Use it when a call must preserve the original function semantics and not be replaced as a built-in.",
    pseudo: "do not use builtin semantics",
    example: "declare void @memcpy(ptr %dst, ptr %src, i64 %n) nobuiltin",
    reference: langRef("function-attributes"),
  }),
  attributeDoc("nocallback", {
    summary:
      "States that the function does not call back into the caller's module except by returning or unwinding.",
    usage:
      "Use it for external functions that cannot invoke callbacks, direct external calls, or longjmp-like control.",
    pseudo: "f does not call back",
    example: "declare void @external() nocallback",
    reference: langRef("function-attributes"),
  }),
  attributeDoc("nodivergencesource", {
    summary: "States that the function is not a source of control-flow divergence.",
    usage: "Use it for targets where divergence analysis needs this function-level guarantee.",
    pseudo: "f does not introduce divergence",
    example: "declare void @f() nodivergencesource",
    reference: langRef("function-attributes"),
  }),
  attributeDoc("noduplicate", {
    summary: "Prevents optimizations from duplicating calls to the function.",
    usage: "Use it for calls where duplication would change semantics, such as certain barriers.",
    pseudo: "do not duplicate calls to f",
    example: "declare void @barrier() noduplicate",
    reference: langRef("function-attributes"),
  }),
  attributeDoc("noimplicitfloat", {
    summary: "Disallows implicit floating-point instructions in generated code for the function.",
    usage:
      "Use it when the function must avoid implicit floating-point register or instruction use.",
    pseudo: "do not introduce implicit float ops",
    example: "define void @f() noimplicitfloat { ret void }",
    reference: langRef("function-attributes"),
  }),
  attributeDoc("nomerge", {
    summary: "Prevents merging this function or call for diagnostic precision.",
    usage: "Use it when merged calls would obscure source locations or diagnostics.",
    pseudo: "keep this call distinct",
    example: "declare void @trap() nomerge",
    reference: langRef("function-attributes"),
  }),
  attributeDoc("nonlazybind", {
    summary: "Requests non-lazy symbol binding for the function.",
    usage: "Use it when the function should be resolved eagerly by the dynamic linker.",
    pseudo: "bind symbol eagerly",
    example: "declare void @f() nonlazybind",
    reference: langRef("function-attributes"),
  }),
  attributeDoc("noprofile", {
    summary: "Disables profile instrumentation for the function.",
    usage: "Use it when profiling counters or instrumentation should not be emitted.",
    pseudo: "do not profile f",
    example: "define void @f() noprofile { ret void }",
    reference: langRef("function-attributes"),
  }),
  attributeDoc("skipprofile", {
    summary: "Skips profile instrumentation for the function.",
    usage: "Use it to omit profiling for code where instrumentation is undesirable.",
    pseudo: "skip profiling f",
    example: "define void @f() skipprofile { ret void }",
    reference: langRef("function-attributes"),
  }),
  attributeDoc("noredzone", {
    summary: "Disables use of the target red zone for the function.",
    usage: "Use it for interrupt handlers or low-level code that cannot rely on a red zone.",
    pseudo: "do not use the red zone",
    example: "define void @f() noredzone { ret void }",
    reference: langRef("function-attributes"),
  }),
  attributeDoc("indirect-tls-seg-refs", {
    summary: "Controls indirect thread-local storage segment references.",
    usage: "Use it for target-specific TLS access lowering requirements.",
    pseudo: "use indirect TLS segment references",
    example: "attributes #0 = { indirect-tls-seg-refs }",
    reference: langRef("function-attributes"),
  }),
  attributeDoc("norecurse", {
    summary: "States that the function is not recursive.",
    usage: "Use it when the function does not participate in direct or indirect recursion.",
    pseudo: "f does not recurse",
    example: "declare void @f() norecurse",
    reference: langRef("function-attributes"),
  }),
  attributeDoc("nosanitize_bounds", {
    summary: "Disables bounds sanitizer instrumentation for the function.",
    usage: "Use it when bounds sanitizer checks must not be inserted.",
    pseudo: "do not instrument bounds checks",
    example: "define void @f() nosanitize_bounds { ret void }",
    reference: langRef("function-attributes"),
  }),
  attributeDoc("nosanitize_coverage", {
    summary: "Disables sanitizer coverage instrumentation for the function.",
    usage: "Use it when sanitizer coverage callbacks should not be inserted.",
    pseudo: "do not add sanitizer coverage",
    example: "define void @f() nosanitize_coverage { ret void }",
    reference: langRef("function-attributes"),
  }),
  attributeDoc("null_pointer_is_valid", {
    summary: "States that address zero is a valid pointer for this function.",
    usage:
      "Use it only when null pointer dereferences in the default address space have defined target semantics.",
    pseudo: "null pointer may be dereferenceable",
    example: "define void @f() null_pointer_is_valid { ret void }",
    reference: langRef("function-attributes"),
  }),
  attributeDoc("optdebug", {
    summary: "Requests optimization choices that improve debug experience.",
    usage: "Use it when preserving debuggability is more important than aggressive optimization.",
    pseudo: "optimize for debugging",
    example: "define void @f() optdebug { ret void }",
    reference: langRef("function-attributes"),
  }),
  attributeDoc("optforfuzzing", {
    summary: "Requests optimization choices suitable for fuzzing.",
    usage:
      "Use it when preserving fuzzing signal is more important than ordinary performance choices.",
    pseudo: "optimize for fuzzing",
    example: "define void @f() optforfuzzing { ret void }",
    reference: langRef("function-attributes"),
  }),
  attributeDoc("optnone", {
    summary: "Disables most optimization passes for the function.",
    usage: "Use it for code that should remain close to the original IR; it requires `noinline`.",
    pseudo: "do not optimize f",
    example: "define void @f() noinline optnone { ret void }",
    reference: langRef("function-attributes"),
  }),
  attributeDoc("optsize", {
    summary: "Requests optimization for code size.",
    usage: "Use it when the optimizer should prefer smaller code over peak speed.",
    pseudo: "optimize f for size",
    example: "define void @f() optsize { ret void }",
    reference: langRef("function-attributes"),
  }),
  attributeDoc('"patchable-function"', {
    summary: "Requests patchable function entry generation.",
    usage: "Use it for runtime patching or instrumentation schemes that need patch points.",
    pseudo: "emit patchable function entry",
    example: 'attributes #0 = { "patchable-function"="prologue-short-redirect" }',
    reference: langRef("function-attributes"),
  }),
  attributeDoc('"patchable-function-prefix"', {
    summary: "Specifies patchable bytes before the function entry.",
    usage: "Use it with patchable-function support when a prefix patch area is required.",
    pseudo: "emit patchable prefix bytes",
    example: 'attributes #0 = { "patchable-function-prefix"="5" }',
    reference: langRef("function-attributes"),
  }),
  attributeDoc('"patchable-function-entry"', {
    summary: "Specifies patchable bytes at the function entry.",
    usage: "Use it when entry patch space is needed for instrumentation or hot patching.",
    pseudo: "emit patchable entry bytes",
    example: 'attributes #0 = { "patchable-function-entry"="2" }',
    reference: langRef("function-attributes"),
  }),
  attributeDoc('"patchable-function-entry-section"', {
    summary: "Names the section for patchable function entry records.",
    usage:
      "Use it with patchable entry instrumentation when records must be placed in a specific section.",
    pseudo: "put patch records in section",
    example:
      'attributes #0 = { "patchable-function-entry-section"="__patchable_function_entries" }',
    reference: langRef("function-attributes"),
  }),
  attributeDoc('"probe-stack"', {
    summary: "Selects a stack probing function or mode.",
    usage: "Use it when large stack allocations require target-specific stack probing.",
    pseudo: "probe stack growth",
    example: 'attributes #0 = { "probe-stack"="__stack_probe" }',
    reference: langRef("function-attributes"),
  }),
  attributeDoc('"stack-probe-size"', {
    summary: "Specifies the stack probe interval size.",
    usage: "Use it with stack probing to control how frequently probes are emitted.",
    pseudo: "probe stack every N bytes",
    example: 'attributes #0 = { "stack-probe-size"="4096" }',
    reference: langRef("function-attributes"),
  }),
  attributeDoc('"no-stack-arg-probe"', {
    summary: "Disables stack argument probing.",
    usage: "Use it for targets or runtimes where argument stack probing must be suppressed.",
    pseudo: "do not probe stack arguments",
    example: 'attributes #0 = { "no-stack-arg-probe" }',
    reference: langRef("function-attributes"),
  }),
  attributeDoc("returns_twice", {
    summary: "States that the function can return more than once.",
    usage: "Use it for setjmp-like functions where control may resume multiple times.",
    pseudo: "call may return twice",
    example: "declare i32 @setjmp(ptr %env) returns_twice",
    reference: langRef("function-attributes"),
  }),
  attributeDoc("safestack", {
    summary: "Enables SafeStack instrumentation for the function.",
    usage: "Use it when the function should be protected by SafeStack.",
    pseudo: "use SafeStack for f",
    example: "define void @f() safestack { ret void }",
    reference: langRef("function-attributes"),
  }),
  attributeDoc("sanitize_address", {
    summary: "Enables AddressSanitizer instrumentation for the function.",
    usage: "Use it when memory access checks should be inserted by AddressSanitizer.",
    pseudo: "instrument f with ASan",
    example: "define void @f() sanitize_address { ret void }",
    reference: langRef("function-attributes"),
  }),
  attributeDoc("sanitize_memory", {
    summary: "Enables MemorySanitizer instrumentation for the function.",
    usage: "Use it when uninitialized memory checks should be inserted by MemorySanitizer.",
    pseudo: "instrument f with MSan",
    example: "define void @f() sanitize_memory { ret void }",
    reference: langRef("function-attributes"),
  }),
  attributeDoc("sanitize_thread", {
    summary: "Enables ThreadSanitizer instrumentation for the function.",
    usage: "Use it when data race checks should be inserted by ThreadSanitizer.",
    pseudo: "instrument f with TSan",
    example: "define void @f() sanitize_thread { ret void }",
    reference: langRef("function-attributes"),
  }),
  attributeDoc("sanitize_hwaddress", {
    summary: "Enables HWAddressSanitizer instrumentation for the function.",
    usage: "Use it when hardware-assisted address checks should be inserted.",
    pseudo: "instrument f with HWASan",
    example: "define void @f() sanitize_hwaddress { ret void }",
    reference: langRef("function-attributes"),
  }),
  attributeDoc("sanitize_memtag", {
    summary: "Enables memory-tagging sanitizer instrumentation.",
    usage:
      "Use it when AArch64 memory tag instrumentation should be applied to a function or to a global described in [Global Attributes](https://llvm.org/docs/LangRef.html#global-attributes).",
    pseudo: "instrument with memory tags",
    example: [
      "define void @f() sanitize_memtag { ret void }",
      "@g = global i32 0, sanitize_memtag",
    ].join("\n"),
    reference: langRef("function-attributes"),
  }),
  attributeDoc("sanitize_realtime", {
    summary: "Enables realtime sanitizer instrumentation for the function.",
    usage: "Use it when realtime safety checks should be inserted.",
    pseudo: "instrument f with realtime checks",
    example: "define void @f() sanitize_realtime { ret void }",
    reference: langRef("function-attributes"),
  }),
  attributeDoc("sanitize_realtime_blocking", {
    summary:
      "Makes RealtimeSanitizer report an error immediately if the function is called during a realtime invocation.",
    usage:
      "Use it to mark functions that must not be called from `sanitize_realtime` code; it is incompatible with `sanitize_realtime`.",
    pseudo: "error if called from realtime code",
    example: "define void @f() sanitize_realtime_blocking { ret void }",
    reference: langRef("function-attributes"),
  }),
  attributeDoc("sanitize_alloc_token", {
    summary: "Enables allocation-token sanitizer instrumentation for the function.",
    usage: "Use it when sanitizer allocation token tracking is required.",
    pseudo: "instrument f with allocation token checks",
    example: "define void @f() sanitize_alloc_token { ret void }",
    reference: langRef("function-attributes"),
  }),
  attributeDoc("speculative_load_hardening", {
    summary: "Enables speculative load hardening for the function.",
    usage: "Use it when the function needs mitigation against speculative load attacks.",
    pseudo: "harden speculative loads",
    example: "define void @f() speculative_load_hardening { ret void }",
    reference: langRef("function-attributes"),
  }),
  attributeDoc("speculatable", {
    summary: "States that calls to the function may be safely speculated.",
    usage:
      "Use it only when the function has no behavior that would make speculative execution invalid.",
    pseudo: "call may be speculated",
    example: "declare i32 @pure(i32 %x) speculatable",
    reference: langRef("function-attributes"),
  }),
  attributeDoc("ssp", {
    summary: "Requests stack smashing protection for the function.",
    usage: "Use it to enable the target's standard stack protector heuristics.",
    pseudo: "enable stack protector",
    example: "define void @f() ssp { ret void }",
    reference: langRef("function-attributes"),
  }),
  attributeDoc("sspstrong", {
    summary: "Requests stronger stack smashing protection for the function.",
    usage: "Use it when stronger stack protector heuristics should be applied.",
    pseudo: "enable strong stack protector",
    example: "define void @f() sspstrong { ret void }",
    reference: langRef("function-attributes"),
  }),
  attributeDoc("sspreq", {
    summary: "Requires stack smashing protection for the function.",
    usage: "Use it when stack protector instrumentation must be emitted.",
    pseudo: "require stack protector",
    example: "define void @f() sspreq { ret void }",
    reference: langRef("function-attributes"),
  }),
  attributeDoc("strictfp", {
    summary: "Requires strict floating-point semantics for the function.",
    usage:
      "Use it when floating-point environment and exception behavior must be preserved strictly.",
    pseudo: "use strict floating-point rules",
    example: "define float @f(float %x) strictfp { ret float %x }",
    reference: langRef("strictfp"),
  }),
  attributeDoc('"thunk"', {
    summary: "Marks a function as a thunk that delegates to another function.",
    usage:
      "Use it when the function body is a tail-call delegation and its prototype should not guide optimization.",
    pseudo: "f delegates through a thunk",
    example: 'attributes #0 = { "thunk" }',
    reference: langRef("function-attributes"),
  }),
  attributeDoc("uwtable", {
    summary: "Requests unwind table generation for the function.",
    usage:
      "Use `uwtable`, `uwtable(sync)`, or `uwtable(async)` according to ABI and unwinding needs.",
    pseudo: "emit unwind table",
    example: "define void @f() uwtable { ret void }",
    reference: langRef("function-attributes"),
  }),
  attributeDoc("nocf_check", {
    summary: "Disables control-flow check instrumentation for the function or call.",
    usage: "Use it when indirect branch tracking or control-flow checks must not apply.",
    pseudo: "do not add CF checks",
    example: "declare void @f() nocf_check",
    reference: langRef("function-attributes"),
  }),
  attributeDoc("shadowcallstack", {
    summary: "Enables shadow call stack instrumentation for the function.",
    usage: "Use it when return addresses should be protected by a shadow call stack.",
    pseudo: "protect returns with shadow call stack",
    example: "define void @f() shadowcallstack { ret void }",
    reference: langRef("function-attributes"),
  }),
  attributeDoc("mustprogress", {
    summary:
      "States that the function must make progress by returning, unwinding, or performing observable behavior.",
    usage: "Use it when infinite side-effect-free execution is not a valid behavior.",
    pseudo: "f must make progress",
    example: "define void @f() mustprogress { ret void }",
    reference: langRef("langref-mustprogress"),
  }),
  attributeDoc('"warn-stack-size"', {
    summary: "Requests a warning if stack usage exceeds a threshold.",
    usage: "Use it to ask the backend to warn about large stack frames.",
    pseudo: "warn if stack exceeds threshold",
    example: 'attributes #0 = { "warn-stack-size"="4096" }',
    reference: langRef("function-attributes"),
  }),
  attributeDoc("vscale_range", {
    summary: "Constrains the possible runtime values of `vscale`.",
    usage:
      "Use `vscale_range(min[, max])` when scalable vector length is known to be within a range.",
    pseudo: "min <= vscale <= max",
    example: "attributes #0 = { vscale_range(1, 16) }",
    reference: langRef("function-attributes"),
  }),
  attributeDoc("nooutline", {
    summary: "Prevents function outlining for the function.",
    usage: "Use it when outlined helper extraction would be undesirable.",
    pseudo: "do not outline f",
    example: "define void @f() nooutline { ret void }",
    reference: langRef("function-attributes"),
  }),
  attributeDoc("nocreateundeforpoison", {
    summary: "Prevents transformations from creating undef from poison for the function.",
    usage: "Use it when the function must preserve stricter poison behavior during optimization.",
    pseudo: "do not create undef from poison",
    example: "define void @f() nocreateundeforpoison { ret void }",
    reference: langRef("function-attributes"),
  }),
  attributeDoc('"modular-format"', {
    summary: "Describes modular format checking metadata for the function.",
    usage: "Use it for frontend-provided format checking schemes described by LangRef.",
    pseudo: "format checking uses modular metadata",
    example: 'attributes #0 = { "modular-format"="printf,0,1,@impl,name" }',
    reference: langRef("function-attributes"),
  }),
  attributeDoc("no_sanitize_address", {
    summary: "Disables AddressSanitizer instrumentation for a global variable.",
    usage: "Use it when a global should not receive AddressSanitizer instrumentation.",
    pseudo: "do not instrument global with ASan",
    example: "@g = global i32 0, no_sanitize_address",
    reference: langRef("global-attributes"),
  }),
  attributeDoc("no_sanitize_hwaddress", {
    summary: "Disables HWAddressSanitizer instrumentation for a global variable.",
    usage: "Use it when a global should not receive HWAddressSanitizer instrumentation.",
    pseudo: "do not instrument global with HWASan",
    example: "@g = global i32 0, no_sanitize_hwaddress",
    reference: langRef("global-attributes"),
  }),
  attributeDoc("sanitize_address_dyninit", {
    summary:
      "Requests AddressSanitizer ODR-violation checking for a dynamically initialized global.",
    usage:
      "Use it on C++-style dynamically initialized globals that should be checked for ODR violations.",
    pseudo: "check ODR violations for g",
    example: "@g = global i32 0, sanitize_address_dyninit",
    reference: langRef("global-attributes"),
  }),
  attributeDoc("address", {
    summary: "Names the pointer address component in `captures(...)`.",
    usage: "Use it inside `captures(...)` when the callee may capture the integral address bits.",
    pseudo: "capture pointer address component",
    example: "declare void @use(ptr captures(address) %p)",
    reference: langRef("captures-attr"),
  }),
  attributeDoc("address_is_null", {
    summary: "Names the nullness-only address component in `captures(...)`.",
    usage: "Use it when only whether the pointer address is null may be captured.",
    pseudo: "capture whether p is null",
    example: "declare void @use(ptr captures(address_is_null) %p)",
    reference: langRef("captures-attr"),
  }),
  attributeDoc("provenance", {
    summary: "Names the pointer provenance component in `captures(...)`.",
    usage: "Use it when the callee may retain provenance that allows later pointer use.",
    pseudo: "capture pointer provenance",
    example: "declare void @use(ptr captures(provenance) %p)",
    reference: langRef("captures-attr"),
  }),
  attributeDoc("read_provenance", {
    summary: "Names provenance captured only for read-only access in `captures(...)`.",
    usage: "Use it when retained provenance may be used for read-only access but not writes.",
    pseudo: "capture provenance for read-only access",
    example: "declare void @use(ptr captures(address, read_provenance) %p)",
    reference: langRef("captures-attr"),
  }),
  attributeDoc("argmem", {
    summary: "Names memory accessed through pointer arguments in `memory(...)`.",
    usage: "Use it as a location kind such as `memory(argmem: read)`.",
    pseudo: "access memory based on pointer arguments",
    example: "declare void @scan(ptr %p) memory(argmem: read)",
    reference: langRef("function-attributes"),
  }),
  attributeDoc("inaccessiblemem", {
    summary: "Names memory not accessible by the current module in `memory(...)`.",
    usage: "Use it as a location kind for inaccessible runtime or target state.",
    pseudo: "access inaccessible memory",
    example: "declare void @f() memory(inaccessiblemem: readwrite)",
    reference: langRef("function-attributes"),
  }),
  attributeDoc("errnomem", {
    summary: "Names memory associated with `errno` in `memory(...)`.",
    usage: "Use it as a location kind when the function may access errno.",
    pseudo: "access errno memory",
    example: "declare void @f() memory(errnomem: write)",
    reference: langRef("function-attributes"),
  }),
  attributeDoc("read", {
    summary: "Names a memory effect that may read but not write.",
    usage: "Use it in `memory(...)` to constrain an access kind to reads.",
    pseudo: "may read memory",
    example: "declare void @scan(ptr %p) memory(read)",
    reference: langRef("function-attributes"),
  }),
  attributeDoc("none", {
    summary: "No memory access is observed for the selected `memory(...)` location.",
    usage:
      "Use it in `memory(none)` or location-qualified forms when no read or write effect is allowed.",
    pseudo: "No memory access",
    example: "declare void @f() memory(none)",
    reference: langRef("function-attributes"),
  }),
  attributeDoc("write", {
    summary: "Names a memory effect whose externally observable behavior is writing.",
    usage: "Use it in `memory(...)` to constrain an access kind to writes.",
    pseudo: "may write memory",
    example: "declare void @fill(ptr %p) memory(write)",
    reference: langRef("function-attributes"),
  }),
  attributeDoc("readwrite", {
    summary: "Names a memory effect that may read or write.",
    usage: "Use it in `memory(...)` when both reads and writes are possible.",
    pseudo: "may read or write memory",
    example: "declare void @update(ptr %p) memory(readwrite)",
    reference: langRef("function-attributes"),
  }),
  attributeDoc("target_mem0", {
    summary: "Names target-specific memory location 0 in `memory(...)`.",
    usage:
      "Use it only for target-specific state described by the target; LangRef marks it experimental.",
    pseudo: "access target-specific memory 0",
    example: "declare void @f() memory(target_mem0: read)",
    reference: langRef("function-attributes"),
  }),
  attributeDoc("target_mem1", {
    summary: "Names target-specific memory location 1 in `memory(...)`.",
    usage:
      "Use it only for target-specific state described by the target; LangRef marks it experimental.",
    pseudo: "access target-specific memory 1",
    example: "declare void @f() memory(target_mem1: write)",
    reference: langRef("function-attributes"),
  }),
  attributeDoc("ieee", {
    summary: "Names IEEE denormal handling mode for `denormal_fpenv`.",
    usage: "Use it when denormal values should follow IEEE behavior.",
    pseudo: "use IEEE denormal behavior",
    example: "attributes #0 = { denormal_fpenv(ieee|ieee) }",
    reference: langRef("denormal-fpenv"),
  }),
  attributeDoc("preservesign", {
    summary: "Names denormal flushing mode that preserves the sign when flushing to zero.",
    usage: "Use it in `denormal_fpenv` when denormal flushing must preserve the sign.",
    pseudo: "flush denormals while preserving the sign",
    example: "attributes #0 = { denormal_fpenv(preservesign|ieee) }",
    reference: langRef("denormal-fpenv"),
  }),
  attributeDoc("positivezero", {
    summary: "Names denormal flushing mode that flushes to positive zero.",
    usage: "Use it in `denormal_fpenv` when flushed denormals should become positive zero.",
    pseudo: "flush denormals to positive zero",
    example: "attributes #0 = { denormal_fpenv(positivezero|ieee) }",
    reference: langRef("denormal-fpenv"),
  }),
  attributeDoc("dynamic", {
    summary: "Names denormal handling derived from the dynamic floating-point environment.",
    usage: "Use it in `denormal_fpenv` when transformations must respect runtime denormal mode.",
    pseudo: "use dynamic denormal behavior",
    example: "attributes #0 = { denormal_fpenv(dynamic|ieee) }",
    reference: langRef("denormal-fpenv"),
  }),
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
        reference: langRef("byte-type"),
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

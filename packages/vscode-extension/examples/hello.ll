; ハイライト動作確認用の小さな LLVM IR サンプル
; opaque pointer (ptr) を前提とした最新安定の記法

source_filename = "hello.c"
target datalayout = "e-m:e-p270:32:32-i64:64-f80:128-n8:16:32:64-S128"
target triple = "x86_64-unknown-linux-gnu"

@.str = private unnamed_addr constant [13 x i8] c"hello world\0A\00", align 1

%struct.Point = type { i32, i32 }

declare i32 @puts(ptr noundef) #0

define dso_local i32 @main() #0 {
entry:
  %retval = alloca i32, align 4
  store i32 0, ptr %retval, align 4
  %call = call i32 @puts(ptr noundef @.str)
  %cmp = icmp sgt i32 %call, 0
  br i1 %cmp, label %then, label %exit

then:
  br label %exit

exit:
  ret i32 0
}

attributes #0 = { nounwind "frame-pointer"="all" }

!llvm.module.flags = !{!0}
!0 = !{i32 1, !"wchar_size", i32 4}

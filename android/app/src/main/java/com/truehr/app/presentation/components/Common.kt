package com.truehr.app.presentation.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Groups
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.truehr.app.presentation.theme.*

fun initials(name: String): String =
  name.trim().split(" ").filter { it.isNotBlank() }.take(2).joinToString("") { it.first().uppercase() }.ifBlank { "U" }

/** Profile photo next to a name (client req #19): loads the colleague's
 *  onboarding photo over the authenticated image loader; initials fallback. */
@Composable
fun EmployeePhoto(id: Long?, name: String, size: androidx.compose.ui.unit.Dp = 46.dp) {
  Box(
    Modifier.size(size).clip(CircleShape).background(Green.copy(alpha = 0.12f)),
    contentAlignment = Alignment.Center,
  ) {
    Text(initials(name), color = Green, fontWeight = FontWeight.Bold)
    if (id != null) {
      coil.compose.AsyncImage(
        model = com.truehr.app.BuildConfig.BASE_URL + "employees/$id/photo",
        contentDescription = name,
        contentScale = androidx.compose.ui.layout.ContentScale.Crop,
        modifier = Modifier.size(size).clip(CircleShape),
      )
    }
  }
}

/** Executive navy gradient header with soft glow accents and rounded base. */
@Composable
fun GradientHeader(content: @Composable BoxScope.() -> Unit) {
  Box(
    modifier = Modifier
      .fillMaxWidth()
      .clip(RoundedCornerShape(bottomStart = 26.dp, bottomEnd = 26.dp))
      .background(Brush.linearGradient(listOf(Navy, NavyMid, NavyBright))),
  ) {
    // Decorative glow circles for depth.
    Box(Modifier.size(190.dp).offset(x = (-60).dp, y = (-80).dp).clip(CircleShape).background(Color.White.copy(alpha = 0.05f)))
    Box(Modifier.size(150.dp).align(Alignment.TopEnd).offset(x = 45.dp, y = (-40).dp).clip(CircleShape).background(Color.White.copy(alpha = 0.06f)))
    Box(
      modifier = Modifier
        .fillMaxWidth()
        .statusBarsPadding()
        .padding(horizontal = 20.dp, vertical = 18.dp),
      content = content,
    )
  }
}

/** Frosted circular icon button used inside gradient headers. */
@Composable
fun HeaderIconButton(icon: ImageVector, contentDescription: String? = null, onClick: () -> Unit) {
  Box(
    modifier = Modifier
      .size(40.dp)
      .clip(CircleShape)
      .background(Color.White.copy(alpha = 0.14f))
      .border(1.dp, Color.White.copy(alpha = 0.18f), CircleShape)
      .clickable(onClick = onClick),
    contentAlignment = Alignment.Center,
  ) {
    Icon(icon, contentDescription, tint = Surface, modifier = Modifier.size(20.dp))
  }
}

@Composable
fun Avatar(name: String, size: Int = 44) {
  Box(
    modifier = Modifier
      .size(size.dp)
      .clip(CircleShape)
      .background(Brush.linearGradient(listOf(Color.White.copy(alpha = 0.32f), Color.White.copy(alpha = 0.14f))))
      .border(1.5.dp, Color.White.copy(alpha = 0.45f), CircleShape),
    contentAlignment = Alignment.Center,
  ) {
    Text(initials(name), color = Surface, fontWeight = FontWeight.Bold, fontSize = (size * 0.34).sp, letterSpacing = 0.5.sp)
  }
}

@Composable
fun SectionTitle(text: String, modifier: Modifier = Modifier) {
  Row(verticalAlignment = Alignment.CenterVertically, modifier = modifier.padding(vertical = 6.dp)) {
    Box(Modifier.width(4.dp).height(17.dp).clip(RoundedCornerShape(2.dp)).background(Green))
    Spacer(Modifier.width(9.dp))
    Text(text, style = MaterialTheme.typography.titleMedium, color = Ink, fontWeight = FontWeight.Bold)
  }
}

@Composable
fun InfoCard(content: @Composable ColumnScope.() -> Unit) {
  Surface(
    color = Surface,
    shape = RoundedCornerShape(18.dp),
    border = BorderStroke(1.dp, Line),
    shadowElevation = 1.dp,
    modifier = Modifier.fillMaxWidth(),
  ) {
    Column(Modifier.padding(18.dp), content = content)
  }
}

@Composable
fun InfoRow(label: String, value: String?) {
  Column(Modifier.padding(vertical = 7.dp)) {
    Text(label.uppercase(), color = InkFaint, style = MaterialTheme.typography.labelSmall, letterSpacing = 0.8.sp)
    Spacer(Modifier.height(2.dp))
    Text(value?.ifBlank { "—" } ?: "—", color = Ink, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium)
  }
}

@Composable
fun PrimaryButton(text: String, enabled: Boolean = true, loading: Boolean = false, onClick: () -> Unit, modifier: Modifier = Modifier) {
  val active = enabled && !loading
  Box(
    modifier = modifier
      .height(52.dp)
      .clip(RoundedCornerShape(14.dp))
      .background(
        if (active) Brush.horizontalGradient(listOf(GreenDark, Green, NavyBright))
        else Brush.horizontalGradient(listOf(InkFaint, InkFaint)),
      )
      .clickable(enabled = active, onClick = onClick),
    contentAlignment = Alignment.Center,
  ) {
    if (loading) CircularProgressIndicator(color = Surface, strokeWidth = 2.dp, modifier = Modifier.size(20.dp))
    else Text(text, color = Surface, style = MaterialTheme.typography.labelLarge, modifier = Modifier.padding(horizontal = 26.dp))
  }
}

@Composable
fun AppTextField(value: String, onValueChange: (String) -> Unit, label: String, modifier: Modifier = Modifier, isPassword: Boolean = false, visualTransformation: androidx.compose.ui.text.input.VisualTransformation = androidx.compose.ui.text.input.VisualTransformation.None, trailing: @Composable (() -> Unit)? = null, keyboardOptions: androidx.compose.foundation.text.KeyboardOptions = androidx.compose.foundation.text.KeyboardOptions.Default) {
  OutlinedTextField(
    value = value,
    onValueChange = onValueChange,
    label = { Text(label) },
    singleLine = true,
    visualTransformation = visualTransformation,
    keyboardOptions = keyboardOptions,
    trailingIcon = trailing,
    shape = RoundedCornerShape(14.dp),
    colors = OutlinedTextFieldDefaults.colors(
      focusedBorderColor = Green,
      unfocusedBorderColor = Line,
      focusedLabelColor = Green,
      unfocusedLabelColor = InkFaint,
      cursorColor = Green,
      focusedContainerColor = Surface,
      unfocusedContainerColor = Surface,
    ),
    modifier = modifier.fillMaxWidth(),
  )
}

@Composable
fun CenterLoader() {
  Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = Green) }
}

/** Shown in team/manager views when the signed-in user has nobody reporting to them. */
@Composable
fun NoTeamState(message: String = "You don't have any team members reporting to you yet.") {
  Column(Modifier.fillMaxSize().padding(28.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
    Box(Modifier.size(64.dp).clip(CircleShape).background(Green.copy(alpha = 0.10f)), contentAlignment = Alignment.Center) {
      Icon(Icons.Filled.Groups, null, tint = Green, modifier = Modifier.size(32.dp))
    }
    Spacer(Modifier.height(14.dp))
    Text("No team yet", style = MaterialTheme.typography.titleMedium, color = Ink, fontWeight = FontWeight.Bold)
    Spacer(Modifier.height(6.dp))
    Text(message, color = InkSoft, style = MaterialTheme.typography.bodyMedium, textAlign = TextAlign.Center)
  }
}

@Composable
fun ErrorState(message: String, onRetry: (() -> Unit)? = null) {
  Column(Modifier.fillMaxSize().padding(28.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
    Text("⚠️", style = MaterialTheme.typography.headlineSmall)
    Spacer(Modifier.height(8.dp))
    Text(message, color = InkSoft, style = MaterialTheme.typography.bodyLarge, textAlign = TextAlign.Center)
    if (onRetry != null) { Spacer(Modifier.height(14.dp)); PrimaryButton("Retry", onClick = onRetry) }
  }
}
